<?php
/**
 * Google service-account sign-in and the few Drive calls we need.
 *
 * Sign-in: a JWT signed with the service account's private key (RS256 via
 * openssl_sign) is exchanged for an access token, cached until shortly
 * before it expires. Read-only Drive scope.
 */

defined( 'ABSPATH' ) || exit;

class MFM_Docs_Google {

	const API        = 'https://www.googleapis.com/drive/v3/files';
	const SCOPE      = 'https://www.googleapis.com/auth/drive.readonly';
	const TOKEN_KEY  = 'mfm_docs_token';
	const FIELDS     = 'id,name,mimeType,modifiedTime,md5Checksum,version,size,parents,trashed,description';

	/** Native Google types we can export, and their export MIME types. */
	const EXPORT = [
		'application/vnd.google-apps.document'     => [ 'pdf' => 'application/pdf', 'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ],
		'application/vnd.google-apps.spreadsheet'  => [ 'pdf' => 'application/pdf' ],
		'application/vnd.google-apps.presentation' => [ 'pdf' => 'application/pdf' ],
		'application/vnd.google-apps.drawing'      => [ 'pdf' => 'application/pdf' ],
	];

	public static function key(): ?array {
		$file = MFM_DOCS_KEY_FILE;
		if ( ! is_readable( $file ) ) {
			return null;
		}
		$key = json_decode( (string) file_get_contents( $file ), true );
		return ( is_array( $key ) && ! empty( $key['client_email'] ) && ! empty( $key['private_key'] ) ) ? $key : null;
	}

	public static function account_email(): string {
		$key = self::key();
		return $key['client_email'] ?? '';
	}

	/** @throws RuntimeException */
	public static function token(): string {
		$cached = get_transient( self::TOKEN_KEY );
		if ( is_string( $cached ) && $cached !== '' ) {
			return $cached;
		}

		$key = self::key();
		if ( ! $key ) {
			throw new RuntimeException( 'Service account key not readable at ' . MFM_DOCS_KEY_FILE );
		}

		$now    = time();
		$b64    = static fn( string $s ): string => rtrim( strtr( base64_encode( $s ), '+/', '-_' ), '=' );
		$head   = $b64( wp_json_encode( [ 'alg' => 'RS256', 'typ' => 'JWT' ] ) );
		$claims = $b64( wp_json_encode( [
			'iss'   => $key['client_email'],
			'scope' => self::SCOPE,
			'aud'   => $key['token_uri'] ?? 'https://oauth2.googleapis.com/token',
			'iat'   => $now,
			'exp'   => $now + 3600,
		] ) );
		$signature = '';
		if ( ! openssl_sign( "$head.$claims", $signature, $key['private_key'], OPENSSL_ALGO_SHA256 ) ) {
			throw new RuntimeException( 'Could not sign the Google sign-in request (bad private key?)' );
		}
		$jwt = "$head.$claims." . $b64( $signature );

		$resp = wp_remote_post( $key['token_uri'] ?? 'https://oauth2.googleapis.com/token', [
			'timeout' => 20,
			'body'    => [
				'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
				'assertion'  => $jwt,
			],
		] );
		$data = self::json( $resp, 'Google sign-in' );
		if ( empty( $data['access_token'] ) ) {
			throw new RuntimeException( 'Google sign-in returned no access token' );
		}
		set_transient( self::TOKEN_KEY, $data['access_token'], max( 60, (int) ( $data['expires_in'] ?? 3600 ) - 120 ) );
		return $data['access_token'];
	}

	/**
	 * Everything directly inside a folder.
	 *
	 * @throws RuntimeException
	 */
	public static function children( string $folder_id ): array {
		$out   = [];
		$token = null;
		do {
			$args = [
				'q'                         => sprintf( "'%s' in parents and trashed = false", $folder_id ),
				'fields'                    => 'nextPageToken,files(' . self::FIELDS . ')',
				'pageSize'                  => 1000,
				'supportsAllDrives'         => 'true',
				'includeItemsFromAllDrives' => 'true',
			];
			if ( $token ) {
				$args['pageToken'] = $token;
			}
			$data  = self::get( add_query_arg( array_map( 'rawurlencode', $args ), self::API ), 'list folder ' . $folder_id );
			$out   = array_merge( $out, $data['files'] ?? [] );
			$token = $data['nextPageToken'] ?? null;
		} while ( $token );
		return $out;
	}

	/** @throws RuntimeException */
	public static function meta( string $id ): array {
		$url = add_query_arg( [ 'fields' => rawurlencode( self::FIELDS ), 'supportsAllDrives' => 'true' ], self::API . '/' . rawurlencode( $id ) );
		return self::get( $url, 'file details ' . $id );
	}

	/** Download a stored (non-Google) file to $dest. @throws RuntimeException */
	public static function download( string $id, string $dest ): void {
		$url = add_query_arg( [ 'alt' => 'media', 'supportsAllDrives' => 'true' ], self::API . '/' . rawurlencode( $id ) );
		self::to_file( $url, $dest, 'download ' . $id );
	}

	/** Export a native Google file to $dest. @throws RuntimeException */
	public static function export( string $id, string $mime, string $dest ): void {
		$url = add_query_arg( [ 'mimeType' => rawurlencode( $mime ) ], self::API . '/' . rawurlencode( $id ) . '/export' );
		self::to_file( $url, $dest, 'export ' . $id );
	}

	/* ------------------------------------------------------------------ */

	private static function auth(): array {
		return [ 'Authorization' => 'Bearer ' . self::token() ];
	}

	private static function get( string $url, string $what ): array {
		$resp = wp_remote_get( $url, [ 'timeout' => 30, 'headers' => self::auth() ] );
		return self::json( $resp, $what );
	}

	private static function to_file( string $url, string $dest, string $what ): void {
		$resp = wp_remote_get( $url, [
			'timeout'  => 180,
			'headers'  => self::auth(),
			'stream'   => true,
			'filename' => $dest,
		] );
		if ( is_wp_error( $resp ) ) {
			@unlink( $dest );
			throw new RuntimeException( "$what failed: " . $resp->get_error_message() );
		}
		$code = wp_remote_retrieve_response_code( $resp );
		if ( $code < 200 || $code >= 300 ) {
			$body = is_readable( $dest ) ? substr( (string) file_get_contents( $dest, false, null, 0, 500 ), 0, 300 ) : '';
			@unlink( $dest );
			throw new RuntimeException( "$what failed: HTTP $code " . self::error_text( $body ) );
		}
	}

	private static function json( $resp, string $what ): array {
		if ( is_wp_error( $resp ) ) {
			throw new RuntimeException( "$what failed: " . $resp->get_error_message() );
		}
		$code = wp_remote_retrieve_response_code( $resp );
		$body = wp_remote_retrieve_body( $resp );
		if ( $code < 200 || $code >= 300 ) {
			throw new RuntimeException( "$what failed: HTTP $code " . self::error_text( $body ) );
		}
		$data = json_decode( $body, true );
		if ( ! is_array( $data ) ) {
			throw new RuntimeException( "$what failed: unreadable response" );
		}
		return $data;
	}

	private static function error_text( string $body ): string {
		$data = json_decode( $body, true );
		if ( isset( $data['error']['message'] ) ) {
			return $data['error']['message'];
		}
		if ( isset( $data['error_description'] ) ) {
			return $data['error_description'];
		}
		return trim( wp_strip_all_tags( substr( $body, 0, 200 ) ) );
	}
}

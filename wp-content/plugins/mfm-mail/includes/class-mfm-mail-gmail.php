<?php
/**
 * Google sign-in and the one Gmail API call MFM Mail needs.
 *
 * Sign-in: a JWT signed with the service account's private key (RS256 via
 * openssl_sign), with "sub" set to the Workspace user to act as, exchanged
 * for an access token and cached until shortly before it expires. This is
 * the same method as mfm-docs, but with domain-wide delegation and only the
 * gmail.send scope (Admin console → Security → API controls → Domain Wide
 * Delegation).
 *
 * Sending: users.messages.send with the whole message, base64url-encoded,
 * as "raw". Gmail keeps the From only if it is the user's own address or on
 * their "Send mail as" list, and signs the message with the domain's DKIM key.
 */

defined( 'ABSPATH' ) || exit;

class MFM_Mail_Gmail {

	const SCOPE    = 'https://www.googleapis.com/auth/gmail.send';
	const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

	/**
	 * Send a complete RFC 822 message. Returns Gmail's message id.
	 *
	 * @throws RuntimeException with Google's own explanation on failure.
	 */
	public static function send( string $mime ): string {
		$body = wp_json_encode( [ 'raw' => self::b64url( $mime ) ] );

		for ( $attempt = 1; ; $attempt++ ) {
			$resp = wp_remote_post( self::SEND_URL, [
				'timeout' => 20,
				'headers' => [
					'Authorization' => 'Bearer ' . self::token(),
					'Content-Type'  => 'application/json',
				],
				'body'    => $body,
			] );
			$code = (int) wp_remote_retrieve_response_code( $resp );

			// A cached token can be revoked early (e.g. delegation changed):
			// forget it and try once more with a fresh one.
			if ( 401 === $code && 1 === $attempt ) {
				delete_transient( self::token_key() );
				continue;
			}
			break;
		}

		$data = self::json( $resp, 'Gmail send' );
		self::debug( 'Gmail accepted the message: id ' . ( $data['id'] ?? '?' ) );
		return (string) ( $data['id'] ?? '' );
	}

	/** @throws RuntimeException */
	public static function token(): string {
		$cached = get_transient( self::token_key() );
		if ( is_string( $cached ) && '' !== $cached ) {
			return $cached;
		}

		$key = self::key();
		$now = time();

		$head   = self::b64url( wp_json_encode( [ 'alg' => 'RS256', 'typ' => 'JWT' ] ) );
		$claims = self::b64url( wp_json_encode( [
			'iss'   => $key['client_email'],
			'sub'   => MFM_MAIL_ACT_AS,
			'scope' => self::SCOPE,
			'aud'   => $key['token_uri'] ?? 'https://oauth2.googleapis.com/token',
			'iat'   => $now,
			'exp'   => $now + 3600,
		] ) );
		$signature = '';
		if ( ! openssl_sign( "$head.$claims", $signature, $key['private_key'], OPENSSL_ALGO_SHA256 ) ) {
			throw new RuntimeException( 'could not sign the Google sign-in request (bad private key?)' );
		}

		self::debug( 'Signing in as ' . $key['client_email'] . ', acting as ' . MFM_MAIL_ACT_AS );
		$resp = wp_remote_post( $key['token_uri'] ?? 'https://oauth2.googleapis.com/token', [
			'timeout' => 20,
			'body'    => [
				'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
				'assertion'  => "$head.$claims." . self::b64url( $signature ),
			],
		] );
		$data = self::json( $resp, 'Google sign-in' );
		if ( empty( $data['access_token'] ) ) {
			throw new RuntimeException( 'Google sign-in returned no access token' );
		}
		set_transient( self::token_key(), $data['access_token'], max( 60, (int) ( $data['expires_in'] ?? 3600 ) - 120 ) );
		return $data['access_token'];
	}

	/** @throws RuntimeException */
	private static function key(): array {
		$file = MFM_MAIL_KEY_FILE;
		if ( ! is_readable( $file ) ) {
			throw new RuntimeException( "service account key not readable at $file" );
		}
		$key = json_decode( (string) file_get_contents( $file ), true );
		if ( ! is_array( $key ) || empty( $key['client_email'] ) || empty( $key['private_key'] ) ) {
			throw new RuntimeException( "$file is not a service account key" );
		}
		return $key;
	}

	/** One cached token per acting user, kept apart from mfm-docs' token. */
	private static function token_key(): string {
		return 'mfm_mail_token_' . md5( MFM_MAIL_ACT_AS );
	}

	/**
	 * @param array|WP_Error $resp
	 * @throws RuntimeException
	 */
	private static function json( $resp, string $what ): array {
		if ( is_wp_error( $resp ) ) {
			throw new RuntimeException( "$what: " . $resp->get_error_message() );
		}
		$code = (int) wp_remote_retrieve_response_code( $resp );
		$body = (string) wp_remote_retrieve_body( $resp );
		self::debug( "$what: HTTP $code" );
		$data = json_decode( $body, true );
		if ( $code < 200 || $code >= 300 || ! is_array( $data ) ) {
			throw new RuntimeException( "$what failed (HTTP $code): " . self::error_text( $body ) );
		}
		return $data;
	}

	/** Google's explanation, from either error shape it uses. */
	private static function error_text( string $body ): string {
		$data = json_decode( $body, true );
		if ( is_array( $data ) ) {
			if ( isset( $data['error']['message'] ) ) {
				return (string) $data['error']['message'];
			}
			if ( isset( $data['error_description'] ) ) {
				return $data['error'] . ': ' . $data['error_description'];
			}
			if ( isset( $data['error'] ) && is_string( $data['error'] ) ) {
				return $data['error'];
			}
		}
		return substr( trim( wp_strip_all_tags( $body ) ), 0, 300 );
	}

	private static function b64url( string $s ): string {
		return rtrim( strtr( base64_encode( $s ), '+/', '-_' ), '=' );
	}

	private static function debug( string $line ): void {
		if ( ! empty( $GLOBALS['mfm_mail_debug'] ) ) {
			fwrite( STDERR, "  $line\n" );
		}
	}
}

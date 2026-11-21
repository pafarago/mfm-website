<?php
/**
 * Settings: the entry folders. Each entry is a top folder in Drive with its
 * own address under /docs/ and its own Up/breadcrumb boundary.
 */

defined( 'ABSPATH' ) || exit;

class MFM_Docs_Settings {

	const OPTION = 'mfm_docs_settings';

	public static function defaults(): array {
		return [
			'entries' => [
				[ 'slug' => 'handbook',         'title' => 'Handbook',         'folder' => '108jvq_M96KTCg9QmVTdOLT5XoN0h9Sl1' ],
				[ 'slug' => 'public-documents', 'title' => 'Public Documents', 'folder' => '1RCis8JgIX-auR9z1R0sukNR43vsf2cMX' ],
				[ 'slug' => 'memorial-minutes', 'title' => 'Memorial Minutes', 'folder' => '1muE17W8AX5BYQoxskW7E4y5iYSluyH9X' ],
			],
		];
	}

	public static function get(): array {
		$saved = get_option( self::OPTION );
		return is_array( $saved ) ? array_merge( self::defaults(), $saved ) : self::defaults();
	}

	/** @return array<string, array{slug:string,title:string,folder:string}> keyed by slug */
	public static function entries(): array {
		$out = [];
		foreach ( self::get()['entries'] as $e ) {
			if ( ! empty( $e['slug'] ) && ! empty( $e['folder'] ) ) {
				$out[ $e['slug'] ] = $e;
			}
		}
		return $out;
	}

	public static function entry_for_root( string $folder_id ): ?array {
		foreach ( self::entries() as $e ) {
			if ( $e['folder'] === $folder_id ) {
				return $e;
			}
		}
		return null;
	}

	public static function is_drive_id( string $id ): bool {
		return (bool) preg_match( '/^[A-Za-z0-9_-]{10,100}$/', $id );
	}

	public static function sanitize( $input ): array {
		$entries = [];
		$seen    = [];
		foreach ( (array) ( $input['entries'] ?? [] ) as $row ) {
			$slug   = sanitize_title( $row['slug'] ?? '' );
			$title  = sanitize_text_field( $row['title'] ?? '' );
			$folder = trim( (string) ( $row['folder'] ?? '' ) );
			// Accept a pasted Drive folder address as well as a bare ID.
			if ( preg_match( '~/folders/([A-Za-z0-9_-]+)~', $folder, $m ) ) {
				$folder = $m[1];
			}
			if ( $slug === '' && $folder === '' ) {
				continue;
			}
			if ( $slug === '' || ! self::is_drive_id( $folder ) || isset( $seen[ $slug ] ) || 'file' === $slug ) {
				add_settings_error( self::OPTION, 'bad-entry', sprintf(
					/* translators: %s: entry title or slug */
					__( 'Skipped an entry with a missing/duplicate address or an invalid folder ID: %s', 'mfm-docs' ),
					$title ?: $slug ?: $folder
				) );
				continue;
			}
			$seen[ $slug ] = true;
			$entries[]     = [ 'slug' => $slug, 'title' => $title ?: $slug, 'folder' => $folder ];
		}
		return [ 'entries' => $entries ];
	}
}

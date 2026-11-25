<?php
/**
 * Settings: the entry folders (each a top folder in Drive with its own
 * address under /docs/ and its own Up/breadcrumb boundary), the help text
 * behind the ? button, and where feedback is sent.
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
			'help'        => self::DEFAULT_HELP,
			'feedback_to' => 'records@midlothianfriends.org',
		];
	}

	const DEFAULT_HELP = "**Opening a document:** tap its title. It opens full screen.\n\n"
		. "**Coming back:** use your browser's back arrow. On a phone that is the ‹ at the top or bottom of the screen; on an iPhone you can also swipe in from the left edge.\n\n"
		. "**Folders:** tap a folder to open it. The ⌃ button beside the heading goes back up one level.\n\n"
		. "**Dates:** \"Updated\" means the document changed recently. \"From archives\" marks older documents.";

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

	/**
	 * The entry folders and the help/feedback settings are saved by two
	 * separate forms, so keep whatever the submitted form didn't include.
	 */
	public static function sanitize( $input ): array {
		$input = (array) $input;
		$out   = self::get();

		if ( array_key_exists( 'help', $input ) ) {
			$out['help'] = trim( sanitize_textarea_field( (string) $input['help'] ) ) ?: self::DEFAULT_HELP;
		}
		if ( array_key_exists( 'feedback_to', $input ) ) {
			$to = sanitize_email( (string) $input['feedback_to'] );
			if ( is_email( $to ) ) {
				$out['feedback_to'] = $to;
			} else {
				add_settings_error( self::OPTION, 'bad-email', __( 'The feedback address is not a valid email address; kept the old one.', 'mfm-docs' ) );
			}
		}
		if ( ! array_key_exists( 'entries', $input ) ) {
			return $out;
		}

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
			if ( $slug === '' || ! self::is_drive_id( $folder ) || isset( $seen[ $slug ] ) || in_array( $slug, [ 'file', 'feedback' ], true ) ) {
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
		$out['entries'] = $entries;
		return $out;
	}

	/**
	 * The help text as HTML: paragraphs from blank lines, **bold** from
	 * double asterisks, everything else escaped.
	 */
	public static function help_html(): string {
		$text = (string) ( self::get()['help'] ?? self::DEFAULT_HELP );
		$html = esc_html( $text );
		$html = preg_replace( '/\*\*(.+?)\*\*/s', '<strong>$1</strong>', $html );
		return wpautop( $html );
	}
}

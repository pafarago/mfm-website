<?php
/**
 * Front end: /docs/ addresses, file streaming, shortcodes, and redirects for
 * old /embed?id=… links.
 */

defined( 'ABSPATH' ) || exit;

class MFM_Docs_Front {

	private static ?array $page = null; // [entry, folder] for a /docs/ folder page

	public static function init(): void {
		add_action( 'init', [ __CLASS__, 'add_rewrites' ] );
		add_action( 'init', [ __CLASS__, 'shortcodes' ], 20 );
		add_filter( 'query_vars', fn( $v ) => array_merge( $v, [ 'mfm_docs_entry', 'mfm_docs_folder', 'mfm_docs_file', 'mfm_docs_fmt' ] ) );
		add_action( 'parse_request', [ __CLASS__, 'legacy_redirect' ], 1 );
		add_action( 'parse_request', [ __CLASS__, 'route' ] );
		add_filter( 'pre_handle_404', fn( $handled ) => self::$page ? true : $handled );
		add_filter( 'template_include', [ __CLASS__, 'template' ], 99 );
		add_filter( 'document_title_parts', [ __CLASS__, 'title' ] );
		add_filter( 'body_class', fn( $c ) => self::$page ? array_merge( $c, [ 'mfm-docs-page' ] ) : $c );
		add_action( 'wp_enqueue_scripts', function () {
			$css = MFM_DOCS_DIR . '/assets/docs.css';
			wp_enqueue_style( 'mfm-docs', plugins_url( 'assets/docs.css', MFM_DOCS_FILE ), [], (string) filemtime( $css ) );
		} );
	}

	public static function add_rewrites(): void {
		add_rewrite_rule( '^docs/file/([A-Za-z0-9_-]{10,100})\.(pdf|docx)$', 'index.php?mfm_docs_file=$matches[1]&mfm_docs_fmt=$matches[2]', 'top' );
		add_rewrite_rule( '^docs/([a-z0-9-]+)/([A-Za-z0-9_-]{10,100})/?$', 'index.php?mfm_docs_entry=$matches[1]&mfm_docs_folder=$matches[2]', 'top' );
		add_rewrite_rule( '^docs/([a-z0-9-]+)/?$', 'index.php?mfm_docs_entry=$matches[1]', 'top' );
	}

	/* ----------------------------------------------------------- routes */

	public static function route( WP $wp ): void {
		$q = $wp->query_vars;

		if ( ! empty( $q['mfm_docs_file'] ) ) {
			self::serve( (string) $q['mfm_docs_file'], (string) ( $q['mfm_docs_fmt'] ?? 'pdf' ) );
			exit;
		}

		if ( ! empty( $q['mfm_docs_entry'] ) ) {
			$entries = MFM_Docs_Settings::entries();
			$slug    = (string) $q['mfm_docs_entry'];
			$folder  = isset( $entries[ $slug ] ) ? ( (string) ( $q['mfm_docs_folder'] ?? '' ) ?: $entries[ $slug ]['folder'] ) : '';
			$f       = $folder ? MFM_Docs_Library::folder( $folder ) : null;
			if ( ! $f || $f['entry'] !== $slug ) {
				$wp->query_vars = [ 'error' => '404' ]; // unknown entry or folder
				return;
			}
			self::$page = [ 'entry' => $slug, 'folder' => $folder ];
		}
	}

	public static function template( string $template ): string {
		if ( ! self::$page ) {
			return $template;
		}
		status_header( 200 );
		global $wp_query;
		$wp_query->is_404 = false;
		return MFM_DOCS_DIR . '/templates/folder-page.php';
	}

	public static function current_page(): ?array {
		return self::$page;
	}

	public static function title( array $parts ): array {
		if ( self::$page ) {
			$f = MFM_Docs_Library::folder( self::$page['folder'] );
			if ( $f ) {
				$parts['title'] = $f['parent'] === '' ? $f['name'] : MFM_Docs_Titles::clean( $f['name'] );
			}
		}
		return $parts;
	}

	/* -------------------------------------------------------- old links */

	/**
	 * /embed?id=…&top=… (old Handbook and Public Documents menu links). Only
	 * once embed-all is switched off; until then it still answers them.
	 */
	public static function legacy_redirect( WP $wp ): void {
		if ( function_exists( 'embedall_shortcode' ) ) {
			return;
		}
		$path = trim( (string) wp_parse_url( $_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH ), '/' );
		$home = trim( (string) wp_parse_url( home_url(), PHP_URL_PATH ), '/' );
		if ( $home !== '' && str_starts_with( $path, $home . '/' ) ) {
			$path = substr( $path, strlen( $home ) + 1 );
		}
		if ( 'embed' !== $path ) {
			return;
		}
		$id = sanitize_text_field( wp_unslash( $_GET['id'] ?? $_GET['Id'] ?? '' ) );
		if ( ! MFM_Docs_Settings::is_drive_id( $id ) ) {
			return;
		}
		$folder = MFM_Docs_Library::folder( $id );
		if ( $folder ) {
			wp_safe_redirect( MFM_Docs_Render::folder_url( $folder['entry'], $id ), 301 );
			exit;
		}
		if ( MFM_Docs_Library::is_allowed( $id ) ) {
			wp_safe_redirect( MFM_Docs_Render::file_url( $id ), 301 );
			exit;
		}
		$wp->query_vars = [ 'error' => '404' ];
	}

	/* ------------------------------------------------------- shortcodes */

	public static function shortcodes(): void {
		add_shortcode( 'mfm_doc', [ __CLASS__, 'sc_doc' ] );
		// The old plugin owns [embed-all] until it is deactivated.
		if ( ! shortcode_exists( 'embed-all' ) ) {
			add_shortcode( 'embed-all', [ __CLASS__, 'sc_embed_all' ] );
		}
	}

	public static function sc_doc( $atts ): string {
		$id = trim( (string) ( shortcode_atts( [ 'id' => '' ], $atts, 'mfm_doc' )['id'] ) );
		if ( ! MFM_Docs_Settings::is_drive_id( $id ) ) {
			return self::admin_notice( '[mfm_doc] needs a Drive file id.' );
		}
		return MFM_Docs_Render::card( $id );
	}

	public static function sc_embed_all( $atts ): string {
		$id = trim( (string) ( shortcode_atts( [ 'id' => '', 'top' => '', 'title' => '', 'height' => '' ], $atts, 'embed-all' )['id'] ) );
		if ( ! MFM_Docs_Settings::is_drive_id( $id ) ) {
			return self::admin_notice( '[embed-all] needs a Drive id.' );
		}
		if ( MFM_Docs_Library::folder( $id ) ) {
			return MFM_Docs_Render::folder( $id, false );
		}
		if ( MFM_Docs_Library::file( $id ) ) {
			return MFM_Docs_Render::card( $id );
		}
		return self::admin_notice( sprintf(
			'This folder (%s) is not one of the folders in Settings → MFM Docs, or has not been synced yet.',
			$id
		) );
	}

	/** Shown only to editors, so visitors never see configuration hints. */
	private static function admin_notice( string $text ): string {
		return current_user_can( 'edit_posts' ) ? MFM_Docs_Render::notice( $text ) : '';
	}

	/* ------------------------------------------------------------ files */

	private static function serve( string $id, string $fmt ): void {
		if ( MFM_Docs_Settings::is_drive_id( $id ) ) {
			MFM_Docs_Library::load_cited( $id );
		}
		if ( ! MFM_Docs_Settings::is_drive_id( $id ) || ! in_array( $fmt, MFM_Docs_Library::formats( $id ), true ) || ! MFM_Docs_Library::is_allowed( $id ) ) {
			self::fail( 404, __( 'Document not found.', 'mfm-docs' ) );
		}

		$file = MFM_Docs_Library::file( $id );
		try {
			$path = MFM_Docs_Cache::ensure( $id, $fmt );
		} catch ( RuntimeException $e ) {
			MFM_Docs_Log::error( $file['name'] . ' (' . $fmt . ') on request: ' . $e->getMessage() );
			header( 'Retry-After: 60' );
			self::fail( 503, __( 'This document is being prepared. Please try again in a minute.', 'mfm-docs' ) );
		}

		$etag = '"' . MFM_Docs_Cache::key( $file ) . '-' . $fmt . '"';
		$size = filesize( $path );
		$name = MFM_Docs_Titles::clean( $file['name'] ) . '.' . $fmt;
		$type = 'pdf' === $fmt ? 'application/pdf' : MFM_Docs_Library::DOCX_MIME;

		while ( ob_get_level() > 0 ) {
			ob_end_clean();
		}
		header_remove( 'Pragma' );
		header_remove( 'Expires' );
		header( 'Cache-Control: public, max-age=300' );
		header( 'ETag: ' . $etag );
		if ( $file['modified'] ) {
			header( 'Last-Modified: ' . gmdate( 'D, d M Y H:i:s', strtotime( $file['modified'] ) ) . ' GMT' );
		}
		header( 'X-Content-Type-Options: nosniff' );
		header( 'X-Robots-Tag: noindex' );

		// WordPress adds slashes to $_SERVER; a browser may send several tags.
		$sent = array_map( 'trim', explode( ',', wp_unslash( (string) ( $_SERVER['HTTP_IF_NONE_MATCH'] ?? '' ) ) ) );
		if ( in_array( $etag, $sent, true ) ) {
			status_header( 304 );
			exit;
		}

		header( 'Content-Type: ' . $type );
		header( sprintf(
			'Content-Disposition: %s; filename="%s"; filename*=UTF-8\'\'%s',
			'pdf' === $fmt ? 'inline' : 'attachment',
			str_replace( [ '"', '\\' ], '', remove_accents( $name ) ),
			rawurlencode( $name )
		) );
		header( 'Accept-Ranges: bytes' );

		// Let Apache send the file if mod_xsendfile is installed.
		if ( function_exists( 'apache_get_modules' ) && in_array( 'mod_xsendfile', apache_get_modules(), true ) ) {
			header( 'X-Sendfile: ' . $path );
			exit;
		}

		$start = 0;
		$end   = $size - 1;
		if ( preg_match( '/^bytes=(\d*)-(\d*)$/', wp_unslash( (string) ( $_SERVER['HTTP_RANGE'] ?? '' ) ), $m ) ) {
			if ( '' === $m[1] && '' !== $m[2] ) {         // last N bytes
				$start = max( 0, $size - (int) $m[2] );
			} else {
				$start = (int) $m[1];
				$end   = '' !== $m[2] ? min( (int) $m[2], $size - 1 ) : $size - 1;
			}
			if ( $start > $end || $start >= $size ) {
				status_header( 416 );
				header( "Content-Range: bytes */$size" );
				exit;
			}
			status_header( 206 );
			header( "Content-Range: bytes $start-$end/$size" );
		} else {
			status_header( 200 );
		}
		header( 'Content-Length: ' . ( $end - $start + 1 ) );

		if ( 'HEAD' === ( $_SERVER['REQUEST_METHOD'] ?? 'GET' ) ) {
			exit;
		}

		$fh = fopen( $path, 'rb' );
		fseek( $fh, $start );
		$left = $end - $start + 1;
		while ( $left > 0 && ! feof( $fh ) && ! connection_aborted() ) {
			$chunk = fread( $fh, (int) min( 1048576, $left ) );
			echo $chunk;
			flush();
			$left -= strlen( $chunk );
		}
		fclose( $fh );
		exit;
	}

	private static function fail( int $code, string $message ): void {
		status_header( $code );
		nocache_headers();
		wp_die( esc_html( $message ), esc_html( get_bloginfo( 'name' ) ), [ 'response' => $code, 'back_link' => true ] );
	}
}

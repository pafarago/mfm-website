<?php
/**
 * HTML for folder pages and document cards.
 *
 *   <div class="mfm-docs">
 *     breadcrumb · Up button · title · ? help menu (folder pages only)
 *     <ul class="mfm-docs__list mfm-docs__list--plain">   rows: folders and documents
 *       document row: title (opens the PDF), "Updated …" or "From archives", PDF chip
 */

defined( 'ABSPATH' ) || exit;

class MFM_Docs_Render {

	public static function folder_url( string $entry, string $folder_id = '' ): string {
		$entries = MFM_Docs_Settings::entries();
		$root    = $entries[ $entry ]['folder'] ?? '';
		$path    = 'docs/' . $entry . '/' . ( $folder_id && $folder_id !== $root ? $folder_id . '/' : '' );
		return home_url( user_trailingslashit( $path ) );
	}

	public static function file_url( string $id, string $fmt = 'pdf' ): string {
		return home_url( 'docs/file/' . $id . '.' . $fmt );
	}

	/** A folder listing with breadcrumb, Up button and title. */
	public static function folder( string $folder_id, bool $as_page = true ): string {
		$chain = MFM_Docs_Library::path( $folder_id );
		if ( ! $chain ) {
			return self::notice( __( 'This folder is not available.', 'mfm-docs' ) );
		}
		$here  = end( $chain );
		$entry = $here['entry'];
		$rows  = MFM_Docs_Library::rows( $folder_id );
		$title = count( $chain ) > 1 ? MFM_Docs_Titles::clean( $here['name'] ) : $here['name'];

		ob_start();
		echo '<div class="mfm-docs">';

		if ( count( $chain ) > 1 ) {
			echo '<nav class="mfm-docs__crumbs" aria-label="' . esc_attr__( 'Folder path', 'mfm-docs' ) . '"><ol>';
			foreach ( $chain as $i => $f ) {
				$label = 0 === $i ? $f['name'] : MFM_Docs_Titles::clean( $f['name'] );
				if ( $i < count( $chain ) - 1 ) {
					printf( '<li><a href="%s">%s</a></li>', esc_url( self::folder_url( $entry, $f['id'] ) ), esc_html( $label ) );
				} else {
					printf( '<li aria-current="page">%s</li>', esc_html( $label ) );
				}
			}
			echo '</ol></nav>';
		}

		echo '<div class="mfm-docs__head">';
		if ( count( $chain ) > 1 ) {
			$parent = $chain[ count( $chain ) - 2 ];
			printf(
				'<a class="mfm-docs__up" href="%1$s" aria-label="%2$s" title="%2$s">%3$s</a>',
				esc_url( self::folder_url( $entry, $parent['id'] ) ),
				/* translators: %s: parent folder name */
				esc_attr( sprintf( __( 'Up to %s', 'mfm-docs' ), 0 === count( $chain ) - 2 ? $parent['name'] : MFM_Docs_Titles::clean( $parent['name'] ) ) ),
				self::icon( 'up' )
			);
		}
		$tag = $as_page ? 'h1' : 'h2';
		printf( '<%1$s class="mfm-docs__title">%2$s</%1$s>', $tag, esc_html( $title ) );
		if ( $as_page ) {
			echo self::help_menu( self::folder_url( $entry, $folder_id ) );
		}
		echo '</div>';

		if ( ! $rows ) {
			echo self::notice( __( 'There are no documents here yet.', 'mfm-docs' ) );
		} else {
			echo '<ul class="mfm-docs__list mfm-docs__list--plain">';
			foreach ( $rows as $row ) {
				echo 'folder' === $row['type'] ? self::folder_row( $row ) : self::doc_row( $row );
			}
			echo '</ul>';
		}

		echo '</div>';
		return (string) ob_get_clean();
	}

	/**
	 * The ? button and its menu: How to use this page (opens the help text in
	 * place), Send feedback to MFM, Return to Home page. A <details> element,
	 * so it works without JavaScript; help.js only closes it on an outside
	 * tap or Escape.
	 */
	public static function help_menu( string $here ): string {
		return sprintf(
			'<details class="mfm-docs__help">'
				. '<summary class="mfm-docs__help-btn" aria-label="%1$s" title="%1$s"><span aria-hidden="true">?</span></summary>'
				. '<div class="mfm-docs__help-menu">'
					. '<details class="mfm-docs__help-how"><summary>%2$s</summary><div class="mfm-docs__help-text">%3$s</div></details>'
					. '<a href="%4$s">%5$s</a>'
					. '<a href="%6$s">%7$s</a>'
				. '</div>'
			. '</details>',
			esc_attr__( 'Help', 'mfm-docs' ),
			esc_html__( 'How to use this page', 'mfm-docs' ),
			MFM_Docs_Settings::help_html(),
			esc_url( MFM_Docs_Feedback::url( $here ) ),
			esc_html__( 'Send feedback to MFM', 'mfm-docs' ),
			esc_url( home_url( '/' ) ),
			esc_html__( 'Return to Home page', 'mfm-docs' )
		);
	}

	/** One document as a stand-alone card ([mfm_doc]). */
	public static function card( string $id ): string {
		$row = MFM_Docs_Library::doc_row_for( $id );
		if ( ! $row ) {
			// Not synced yet (just added to a page): link straight to it.
			return sprintf(
				'<div class="mfm-docs mfm-docs--card"><ul class="mfm-docs__list mfm-docs__list--plain"><li class="mfm-docs__row mfm-docs__row--doc"><div class="mfm-docs__body"><a class="mfm-docs__name" href="%s">%s</a></div></li></ul></div>',
				esc_url( self::file_url( $id ) ),
				esc_html__( 'Open document', 'mfm-docs' )
			);
		}
		return '<div class="mfm-docs mfm-docs--card"><ul class="mfm-docs__list mfm-docs__list--plain">' . self::doc_row( $row ) . '</ul></div>';
	}

	private static function folder_row( array $row ): string {
		return sprintf(
			'<li class="mfm-docs__row mfm-docs__row--folder"><a class="mfm-docs__folder" href="%1$s">%2$s<span class="mfm-docs__name">%3$s</span>%4$s</a></li>',
			esc_url( self::folder_url( $row['entry'], $row['id'] ) ),
			self::icon( 'folder' ),
			esc_html( $row['title'] ),
			self::icon( 'chevron' )
		);
	}

	private static function doc_row( array $row ): string {
		$pdf = self::file_url( $row['id'], 'pdf' );
		$ts  = $row['modified'] ? (int) strtotime( $row['modified'] ) : 0;
		if ( $ts && $ts >= (int) strtotime( MFM_DOCS_UPDATED_SINCE . ' 00:00:00 UTC' ) ) {
			$meta = sprintf(
				'<span class="mfm-docs__meta">%s <time datetime="%s">%s</time></span>',
				esc_html__( 'Updated', 'mfm-docs' ),
				esc_attr( gmdate( 'c', $ts ) ),
				esc_html( wp_date( 'M j, Y', $ts ) )
			);
		} else {
			$meta = '<span class="mfm-docs__meta">' . esc_html__( 'From archives', 'mfm-docs' ) . '</span>';
		}
		return sprintf(
			'<li class="mfm-docs__row mfm-docs__row--doc"><div class="mfm-docs__body"><a class="mfm-docs__name" href="%1$s">%2$s</a>%3$s<span class="mfm-docs__chips"><a class="mfm-docs__chip mfm-docs__chip--pdf" href="%1$s">PDF</a></span></div></li>',
			esc_url( $pdf ),
			esc_html( $row['title'] ),
			$meta
		);
	}

	public static function notice( string $text ): string {
		return '<p class="mfm-docs__notice">' . esc_html( $text ) . '</p>';
	}

	private static function icon( string $name ): string {
		$paths = [
			'folder'  => 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
			'chevron' => 'M9 6l6 6-6 6',
			'up'      => 'M6 15l6-6 6 6',
		];
		return '<svg class="mfm-docs__icon mfm-docs__icon--' . $name . '" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="' . $paths[ $name ] . '"/></svg>';
	}
}

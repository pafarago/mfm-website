<?php
/**
 * Display titles from Drive file names, and the sort order.
 *
 * Sorting uses the raw name naturally, so "1.0 Overview" comes before
 * "About …" and "2.10" after "2.9"; the numbering itself is not shown.
 */

defined( 'ABSPATH' ) || exit;

class MFM_Docs_Titles {

	const SMALL    = [ 'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'per', 'the', 'to', 'vs', 'via' ];
	const ACRONYMS = [ 'MFM', 'BYM', 'FCNL', 'PDF', 'FAQ', 'RFM', 'FGC', 'AFSC', 'FWCC', 'QEW', 'CO' ];
	const EXT      = '/\.(pdf|docx?|xlsx?|xlsm|pptx?|odt|ods|odp|rtf|txt|gdoc|gsheet|gslides)$/i';

	/** "2.1 meeting_for-business.docx" → "Meeting for Business" */
	public static function clean( string $name ): string {
		$t = trim( $name );
		$t = preg_replace( self::EXT, '', $t );
		$t = preg_replace( '/^\d+(\.\d+)*[.)]?\s+/', '', $t );       // leading "1.0 " / "2.1.3 " / "4) "
		$t = preg_replace( '/\s*\[\d{6,}\]\s*$/', '', $t );         // trailing "[2305843009231563675]"
		$t = preg_replace_callback( '/\b\d{1,4}-\d{1,2}-\d{1,4}\b/', fn( $m ) => str_replace( '-', '§', $m[0] ), $t ); // keep dates
		$t = str_replace( '_', ' ', $t );
		$t = preg_replace( '/\s+-\s+|(?<=\S)-(?=\s)|(?<=\s)-(?=\S)/', ' – ', $t ); // spaced dashes read as separators
		$t = str_replace( '§', '-', $t );
		$t = trim( preg_replace( '/\s+/', ' ', $t ) );

		$words = explode( ' ', $t );
		$last  = count( $words ) - 1;
		foreach ( $words as $i => &$w ) {
			if ( $w === '' || $w === '–' ) {
				continue;
			}
			$core = trim( $w, '()[]",.:;!?\'' );
			$up   = strtoupper( $core );
			if ( in_array( $up, self::ACRONYMS, true ) || preg_match( '/^[A-Z]{2,5}s?$/', $core ) ) {
				$w = str_replace( $core, in_array( $up, self::ACRONYMS, true ) ? $up : $core, $w );
				continue;
			}
			if ( preg_match( '/\d/', $core ) || preg_match( '/[a-z][A-Z]/', $core ) ) {
				continue; // "2026", "iPhone", "McNeil": leave alone
			}
			$lower = mb_strtolower( $w );
			if ( $i > 0 && $i < $last && in_array( trim( $lower, '(),.:;' ), self::SMALL, true ) && ( $words[ $i - 1 ] ?? '' ) !== '–' ) {
				$w = $lower;
				continue;
			}
			// Capitalise each part of hyphenated words: "non-partisan" → "Non-Partisan".
			$w = implode( '-', array_map( fn( $p ) => mb_strtoupper( mb_substr( $p, 0, 1 ) ) . mb_substr( $p, 1 ), explode( '-', $lower ) ) );
			$w = preg_replace_callback( '/^([("\'])(\p{Ll})/u', fn( $m ) => $m[1] . mb_strtoupper( $m[2] ), $w );
		}
		return implode( ' ', $words );
	}

	/** Group key so "Minutes 2025.pdf" and "Minutes 2025.docx" pair up. */
	public static function base( string $name ): string {
		return mb_strtolower( trim( preg_replace( self::EXT, '', $name ) ) );
	}

	public static function compare( string $a, string $b ): int {
		return strnatcasecmp( $a, $b );
	}
}

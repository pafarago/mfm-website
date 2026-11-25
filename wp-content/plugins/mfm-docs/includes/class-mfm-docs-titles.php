<?php
/**
 * Display titles from Drive file names, and the sort order.
 *
 * Sorting uses the raw name naturally, so "1.0 Overview" comes before
 * "About …" and "2.10" after "2.9"; the numbering itself is not shown.
 * A leading year ("2019 Minutes") is part of the title and stays.
 *
 * A folder can ask for date order instead, with a line in its Drive
 * Description (inherited by sub-folders until one has its own line):
 *   sort: date-desc   newest first
 *   sort: date-asc    oldest first
 *   sort: name        A–Z (the default)
 * Dates are read from the name: 2025-10-02, 10-2-2025, 10/2/2025,
 * October 2, 2025, 2 Oct 2025, Oct 2025, or a year. Undated items come last, A–Z.
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
		$t = preg_replace( '/^(?!(?:19|20)\d\d\s)\d+(\.\d+)*[.)]?\s+/', '', $t ); // leading "1.0 " / "2.1.3 " / "4) " / "0 ", but not a year
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

	/** The "sort:" mode in a Drive Description: date-desc, date-asc, name, or '' for none. */
	public static function sort_mode( string $description ): string {
		return preg_match( '/^\s*sort\s*:\s*(date-desc|date-asc|name)\s*$/mi', $description, $m ) ? strtolower( $m[1] ) : '';
	}

	/**
	 * A sortable date found in a name, "YYYY-MM-DD" with "00" for a missing
	 * month or day, or '' when the name holds no date.
	 */
	public static function date_key( string $name ): string {
		$n   = preg_replace( self::EXT, '', $name );
		$mon = [ 'jan' => 1, 'feb' => 2, 'mar' => 3, 'apr' => 4, 'may' => 5, 'jun' => 6, 'jul' => 7, 'aug' => 8, 'sep' => 9, 'oct' => 10, 'nov' => 11, 'dec' => 12 ];
		$key = static fn( int $y, int $m = 0, int $d = 0 ): string =>
			( $y >= 1900 && $y <= 2099 && $m <= 12 && $d <= 31 ) ? sprintf( '%04d-%02d-%02d', $y, $m, $d ) : '';
		$mn  = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?';

		// 2025-10-02, 2025-10, 2025_10_02, 2025.10.02
		if ( preg_match( '/(?<!\d)((?:19|20)\d\d)[-_.](\d{1,2})(?:[-_.](\d{1,2}))?(?!\d)/', $n, $m ) ) {
			return $key( (int) $m[1], (int) $m[2], (int) ( $m[3] ?? 0 ) );
		}
		// 10-2-2025, 10/2/2025, 10.2.2025 (US order)
		if ( preg_match( '/(?<!\d)(\d{1,2})[-\/.](\d{1,2})[-\/.]((?:19|20)\d\d)(?!\d)/', $n, $m ) ) {
			return $key( (int) $m[3], (int) $m[1], (int) $m[2] );
		}
		// 2 October 2025
		if ( preg_match( '/(?<!\d)(\d{1,2})\s+' . $mn . '\s+((?:19|20)\d\d)(?!\d)/i', $n, $m ) ) {
			return $key( (int) $m[3], $mon[ strtolower( $m[2] ) ], (int) $m[1] );
		}
		// October 2, 2025 / Oct 2 2025 / Oct. 2nd, 2025 / October 2025
		if ( preg_match( '/\b' . $mn . '\s+(?:(\d{1,2})(?:st|nd|rd|th)?,?\s+)?((?:19|20)\d\d)(?!\d)/i', $n, $m ) ) {
			return $key( (int) $m[3], $mon[ strtolower( $m[1] ) ], (int) $m[2] );
		}
		// A year on its own: "2019 Minutes", "Minutes 2019"
		if ( preg_match( '/(?<!\d)((?:19|20)\d\d)(?!\d)/', $n, $m ) ) {
			return $key( (int) $m[1] );
		}
		return '';
	}
}

<?php
/**
 * A short rolling log shown on Settings → MFM Docs (and mirrored to the PHP
 * error log for errors).
 */

defined( 'ABSPATH' ) || exit;

class MFM_Docs_Log {

	const OPTION = 'mfm_docs_log';
	const KEEP   = 40;

	public static function info( string $msg ): void {
		self::add( 'info', $msg );
	}

	public static function error( string $msg ): void {
		self::add( 'error', $msg );
		error_log( '[mfm-docs] ' . $msg );
	}

	public static function entries(): array {
		$log = get_option( self::OPTION, [] );
		return is_array( $log ) ? $log : [];
	}

	private static function add( string $level, string $msg ): void {
		$log   = self::entries();
		$log[] = [ 't' => time(), 'level' => $level, 'msg' => $msg ];
		if ( count( $log ) > self::KEEP ) {
			$log = array_slice( $log, -self::KEEP );
		}
		update_option( self::OPTION, $log, false );
	}
}

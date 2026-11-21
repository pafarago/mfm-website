<?php
/**
 * Front-end CSS and JS. Versions come from file modification times, so a
 * deploy always busts browser caches without manual version bumps.
 */

defined( 'ABSPATH' ) || exit;

function mfm_asset_version( string $relative ): string {
	$path = MFM_THEME_DIR . '/' . $relative;
	return file_exists( $path ) ? (string) filemtime( $path ) : wp_get_theme()->get( 'Version' );
}

add_action( 'wp_enqueue_scripts', function () {
	wp_enqueue_style(
		'mfm-theme',
		MFM_THEME_URI . '/assets/css/theme.css',
		[],
		mfm_asset_version( 'assets/css/theme.css' )
	);

	wp_enqueue_script(
		'mfm-nav',
		MFM_THEME_URI . '/assets/js/nav.js',
		[],
		mfm_asset_version( 'assets/js/nav.js' ),
		[ 'strategy' => 'defer', 'in_footer' => false ]
	);
} );

add_action( 'wp_head', function () {
	echo '<meta name="theme-color" content="#ffffff">' . "\n";
}, 1 );

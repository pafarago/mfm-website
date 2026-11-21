<?php
/**
 * Maintenance mode (Customize → MFM site options).
 *
 * Visitors get template-parts/maintenance.php with HTTP 503 + Retry-After, so
 * search engines don't index the "back soon" page. Logged-in editors see the
 * normal site plus a red notice in the admin bar. Admin, login, REST and cron
 * never pass through template_redirect, so they keep working.
 */

defined( 'ABSPATH' ) || exit;

add_action( 'template_redirect', function () {
	if ( ! mfm_option( 'mfm_maintenance' ) || current_user_can( 'edit_posts' ) ) {
		return;
	}
	status_header( 503 );
	header( 'Retry-After: 3600' );
	nocache_headers();
	get_template_part( 'template-parts/maintenance' );
	exit;
}, 0 );

add_action( 'admin_bar_menu', function ( WP_Admin_Bar $bar ) {
	if ( ! mfm_option( 'mfm_maintenance' ) ) {
		return;
	}
	$bar->add_node( [
		'id'    => 'mfm-maintenance',
		'title' => esc_html__( 'Maintenance mode is ON', 'mfm-theme' ),
		'href'  => admin_url( 'customize.php?autofocus[section]=mfm_site' ),
		'meta'  => [ 'class' => 'mfm-maintenance-flag' ],
	] );
}, 100 );

add_action( 'wp_head', 'mfm_maintenance_flag_style' );
add_action( 'admin_head', 'mfm_maintenance_flag_style' );
function mfm_maintenance_flag_style(): void {
	if ( is_admin_bar_showing() && mfm_option( 'mfm_maintenance' ) ) {
		echo '<style>#wpadminbar .mfm-maintenance-flag > a{background:#b42318!important;color:#fff!important}</style>' . "\n";
	}
}

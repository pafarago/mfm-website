<?php
/**
 * Site options (Appearance → Customize → MFM site options).
 *
 *   mfm_worship_line     shown in the phone menu drawer
 *   mfm_address_line     shown in the drawer and the footer
 *   mfm_maintenance      on/off; visitors get a 503 page, editors see the site
 *   mfm_maintenance_msg  text on the maintenance page
 */

defined( 'ABSPATH' ) || exit;

function mfm_option_defaults(): array {
	return [
		'mfm_worship_line'    => 'Sunday worship 11:00 AM',
		'mfm_address_line'    => '900 Preservation Rd, Midlothian, VA 23113',
		'mfm_maintenance'     => false,
		'mfm_maintenance_msg' => 'Our website is being updated. Please check back soon.',
	];
}

function mfm_option( string $key ) {
	$defaults = mfm_option_defaults();
	return get_theme_mod( $key, $defaults[ $key ] ?? '' );
}

add_action( 'customize_register', function ( WP_Customize_Manager $wp_customize ) {
	$defaults = mfm_option_defaults();

	$wp_customize->add_section( 'mfm_site', [
		'title'    => __( 'MFM site options', 'mfm-theme' ),
		'priority' => 30,
	] );

	$text = [
		'mfm_worship_line' => __( 'Worship time line', 'mfm-theme' ),
		'mfm_address_line' => __( 'Address line', 'mfm-theme' ),
	];
	foreach ( $text as $id => $label ) {
		$wp_customize->add_setting( $id, [
			'default'           => $defaults[ $id ],
			'sanitize_callback' => 'sanitize_text_field',
		] );
		$wp_customize->add_control( $id, [
			'label'   => $label,
			'section' => 'mfm_site',
			'type'    => 'text',
		] );
	}

	$wp_customize->add_setting( 'mfm_maintenance', [
		'default'           => false,
		'sanitize_callback' => 'rest_sanitize_boolean',
	] );
	$wp_customize->add_control( 'mfm_maintenance', [
		'label'       => __( 'Maintenance mode', 'mfm-theme' ),
		'description' => __( 'Visitors see a "back soon" page. Anyone who can edit posts still sees the site.', 'mfm-theme' ),
		'section'     => 'mfm_site',
		'type'        => 'checkbox',
	] );

	$wp_customize->add_setting( 'mfm_maintenance_msg', [
		'default'           => $defaults['mfm_maintenance_msg'],
		'sanitize_callback' => 'sanitize_textarea_field',
	] );
	$wp_customize->add_control( 'mfm_maintenance_msg', [
		'label'   => __( 'Maintenance message', 'mfm-theme' ),
		'section' => 'mfm_site',
		'type'    => 'textarea',
	] );
} );

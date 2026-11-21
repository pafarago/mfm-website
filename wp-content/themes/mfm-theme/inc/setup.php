<?php
/**
 * Theme supports, menu locations, editor styles and small head clean-ups.
 */

defined( 'ABSPATH' ) || exit;

add_action( 'after_setup_theme', function () {
	add_theme_support( 'title-tag' );
	add_theme_support( 'automatic-feed-links' );
	add_theme_support( 'post-thumbnails' );
	add_theme_support( 'responsive-embeds' );
	add_theme_support( 'html5', [ 'search-form', 'comment-form', 'comment-list', 'gallery', 'caption', 'style', 'script', 'navigation-widgets' ] );
	add_theme_support( 'custom-logo', [
		'height'      => 172,
		'width'       => 509,
		'flex-height' => true,
		'flex-width'  => true,
	] );

	add_theme_support( 'editor-styles' );
	add_editor_style( 'assets/css/editor.css' );

	// "primary" matches the location name the old theme registered, so the
	// existing menu carries over when the theme is switched.
	register_nav_menus( [
		'primary' => __( 'Main menu', 'mfm-theme' ),
		'footer'  => __( 'Footer links', 'mfm-theme' ),
	] );
} );

/* Leaner <head>: no emoji polyfill, no generator tag. */
remove_action( 'wp_head', 'print_emoji_detection_script', 7 );
remove_action( 'wp_print_styles', 'print_emoji_styles' );
remove_action( 'admin_print_scripts', 'print_emoji_detection_script' );
remove_action( 'admin_print_styles', 'print_emoji_styles' );
remove_action( 'wp_head', 'wp_generator' );

/* Excerpts: 30 words, as on the old site. */
add_filter( 'excerpt_length', fn() => 30 );
add_filter( 'excerpt_more', fn() => '…' );

/* "News", not "Category: News". */
add_filter( 'get_the_archive_title_prefix', '__return_empty_string' );

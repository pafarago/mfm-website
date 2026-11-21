<?php
/**
 * Small helpers used by the templates.
 */

defined( 'ABSPATH' ) || exit;

/**
 * Inline stroke icons (decorative; the surrounding control carries the label).
 */
function mfm_icon( string $name ): string {
	$paths = [
		'menu'         => 'M4 7h16M4 12h16M4 17h16',
		'close'        => 'M6 6l12 12M18 6L6 18',
		'chevron'      => 'M6 9l6 6 6-6',
		'chevron-left' => 'M15 6l-6 6 6 6',
		'arrow-left'   => 'M19 12H5M11 6l-6 6 6 6',
	];
	if ( ! isset( $paths[ $name ] ) ) {
		return '';
	}
	return '<svg class="icon icon--' . esc_attr( $name ) . '" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="' . $paths[ $name ] . '"/></svg>';
}

/**
 * Site logo: the Customizer logo if one is set, otherwise the bundled one.
 */
function mfm_logo(): void {
	$name = get_bloginfo( 'name' );
	$logo_id = get_theme_mod( 'custom_logo' );

	echo '<a class="site-brand" href="' . esc_url( home_url( '/' ) ) . '" rel="home">';
	if ( $logo_id ) {
		echo wp_get_attachment_image( $logo_id, 'full', false, [
			'class'         => 'site-brand__logo',
			'alt'           => $name,
			'fetchpriority' => 'high',
			'loading'       => 'eager',
		] );
	} else {
		printf(
			'<img class="site-brand__logo" src="%s" width="509" height="172" alt="%s" fetchpriority="high">',
			esc_url( MFM_THEME_URI . '/assets/images/logo.png' ),
			esc_attr( $name )
		);
	}
	echo '</a>';
}

/**
 * The main menu, rendered once with MFM_Nav_Walker.
 */
function mfm_primary_menu(): void {
	wp_nav_menu( [
		'theme_location' => 'primary',
		'container'      => false,
		'menu_class'     => 'menu menu--top',
		'menu_id'        => 'menu-top',
		'depth'          => 2,
		'walker'         => new MFM_Nav_Walker(),
		'fallback_cb'    => 'mfm_menu_fallback',
		'items_wrap'     => '<ul id="%1$s" class="%2$s">%3$s</ul>',
	] );
}

/**
 * "Back to News" link for a single post: its first category, else the home page.
 */
function mfm_back_link( string $where = 'top' ): void {
	$cats  = get_the_category();
	$url   = $cats ? get_category_link( $cats[0]->term_id ) : home_url( '/' );
	$label = $cats ? sprintf( __( 'Back to %s', 'mfm-theme' ), $cats[0]->name ) : __( 'Home', 'mfm-theme' );

	printf(
		'<p class="back-link back-link--%1$s"><a href="%2$s">%3$s%4$s</a></p>',
		esc_attr( $where ),
		esc_url( $url ),
		mfm_icon( 'arrow-left' ),
		esc_html( $label )
	);
}

/**
 * Publication date as a <time> element.
 */
function mfm_post_date( string $format = '' ): string {
	return sprintf(
		'<time class="post-date" datetime="%1$s">%2$s</time>',
		esc_attr( get_the_date( 'c' ) ),
		esc_html( get_the_date( $format ?: 'D, M j, Y' ) )
	);
}

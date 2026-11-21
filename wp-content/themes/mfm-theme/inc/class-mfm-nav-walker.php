<?php
/**
 * Main menu markup. One copy of the menu serves phones (drawer with slide-in
 * sub-panels) and wide screens (horizontal bar with dropdowns); CSS decides
 * the layout, assets/js/nav.js only switches states.
 *
 *   <li class="menu-item has-sub">
 *     <button class="menu-button" aria-expanded="false" aria-controls="submenu-12">Engage</button>
 *     <div class="submenu" id="submenu-12">
 *       <div class="submenu__head">  ‹ Main menu  ·  ✕   (phone only)
 *       <p class="submenu__title">Engage</p>             (phone only)
 *       <ul class="menu menu--sub"> … </ul>
 *     </div>
 *   </li>
 *
 * A parent item that has a real URL (not "#") also gets a first link to that
 * URL inside its sub-menu, because the parent itself is now a button.
 */

defined( 'ABSPATH' ) || exit;

class MFM_Nav_Walker extends Walker_Nav_Menu {

	/** Parent items whose sub-menus are being written (innermost last). */
	private array $parents = [];

	public function start_lvl( &$output, $depth = 0, $args = null ) {
		$parent = end( $this->parents );
		$id     = $parent ? (int) $parent->ID : 0;
		$title  = $parent ? $this->item_title( $parent, $args, $depth ) : '';

		$output .= '<div class="submenu" id="submenu-' . $id . '">';
		$output .= '<div class="submenu__head">';
		$output .= '<button type="button" class="submenu__back">' . mfm_icon( 'chevron-left' ) . esc_html__( 'Main menu', 'mfm-theme' ) . '</button>';
		$output .= '<button type="button" class="nav-close" aria-label="' . esc_attr__( 'Close menu', 'mfm-theme' ) . '">' . mfm_icon( 'close' ) . '</button>';
		$output .= '</div>';
		$output .= '<p class="submenu__title">' . esc_html( $title ) . '</p>';
		$output .= '<ul class="menu menu--sub">';

		if ( $parent && $this->has_real_url( $parent ) ) {
			$output .= '<li class="menu-item menu-item--parent-link">' . $this->link( $parent, $title ) . '</li>';
		}
	}

	public function end_lvl( &$output, $depth = 0, $args = null ) {
		$output .= '</ul></div>';
	}

	public function start_el( &$output, $data_object, $depth = 0, $args = null, $current_object_id = 0 ) {
		$item  = $data_object;
		$title = $this->item_title( $item, $args, $depth );

		$classes = array_filter( (array) $item->classes, fn( $c ) => is_string( $c ) && $c !== '' );
		$keep    = array_values( array_filter( $classes, fn( $c ) =>
			str_starts_with( $c, 'current' ) || ! str_starts_with( $c, 'menu-item' ) ) );
		$keep[]  = 'menu-item';

		$is_parent = $this->has_children && 0 === $depth;
		if ( $is_parent ) {
			$keep[]          = 'has-sub';
			$this->parents[] = $item;
		}

		$output .= '<li class="' . esc_attr( implode( ' ', array_unique( $keep ) ) ) . '">';

		if ( $is_parent ) {
			$output .= sprintf(
				'<button type="button" class="menu-button" aria-expanded="false" aria-controls="submenu-%1$d">%2$s%3$s</button>',
				(int) $item->ID,
				esc_html( $title ),
				mfm_icon( 'chevron' )
			);
		} else {
			$output .= $this->link( $item, $title );
		}
	}

	public function end_el( &$output, $data_object, $depth = 0, $args = null ) {
		if ( $this->parents && end( $this->parents ) === $data_object ) {
			array_pop( $this->parents );
		}
		$output .= '</li>';
	}

	private function item_title( $item, $args, int $depth ): string {
		$title = apply_filters( 'the_title', $item->title, $item->ID );
		return wp_strip_all_tags( (string) apply_filters( 'nav_menu_item_title', $title, $item, $args, $depth ) );
	}

	private function has_real_url( $item ): bool {
		$url = trim( (string) $item->url );
		return $url !== '' && $url !== '#' && ! str_starts_with( $url, '#' );
	}

	private function link( $item, string $title ): string {
		$attrs = [
			'class' => 'menu-link',
			'href'  => $item->url,
		];
		if ( ! empty( $item->attr_title ) ) {
			$attrs['title'] = $item->attr_title;
		}
		if ( ! empty( $item->target ) ) {
			$attrs['target'] = $item->target;
		}
		$rel = trim( (string) $item->xfn );
		if ( '_blank' === $item->target ) {
			$rel = trim( $rel . ' noopener' );
		}
		if ( $rel !== '' ) {
			$attrs['rel'] = $rel;
		}
		if ( in_array( 'current-menu-item', (array) $item->classes, true ) ) {
			$attrs['aria-current'] = 'page';
		}

		$html = '<a';
		foreach ( $attrs as $name => $value ) {
			$html .= ' ' . $name . '="' . ( 'href' === $name ? esc_url( $value ) : esc_attr( $value ) ) . '"';
		}
		return $html . '>' . esc_html( $title ) . '</a>';
	}
}

/**
 * Menu fallback: before a menu is assigned to the "Main menu" location, use
 * the first menu that exists (the old theme never assigned one).
 */
function mfm_menu_fallback( $args ) {
	$menus = wp_get_nav_menus();
	if ( ! $menus ) {
		return '';
	}
	$args = (array) $args;
	$args['menu']           = $menus[0];
	$args['theme_location'] = '';
	$args['fallback_cb']    = false;
	return wp_nav_menu( $args );
}

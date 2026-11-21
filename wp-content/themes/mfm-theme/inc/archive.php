<?php
/**
 * Archive support: page size and the year filter shown on category pages
 * (e.g. News → 2026 · 2025 · …).
 */

defined( 'ABSPATH' ) || exit;

add_action( 'pre_get_posts', function ( WP_Query $q ) {
	if ( is_admin() || ! $q->is_main_query() ) {
		return;
	}
	if ( $q->is_category() || $q->is_tag() || $q->is_date() || $q->is_home() ) {
		$q->set( 'posts_per_page', 20 );
	}
} );

/**
 * Years that have published posts in a category, newest first.
 *
 * @return int[]
 */
function mfm_category_years( int $term_id ): array {
	global $wpdb;
	$years = $wpdb->get_col( $wpdb->prepare(
		"SELECT DISTINCT YEAR(p.post_date) AS y
		   FROM {$wpdb->posts} p
		   JOIN {$wpdb->term_relationships} tr ON tr.object_id = p.ID
		   JOIN {$wpdb->term_taxonomy} tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
		  WHERE tt.term_id = %d AND tt.taxonomy = 'category'
		    AND p.post_type = 'post' AND p.post_status = 'publish'
		  ORDER BY y DESC",
		$term_id
	) );
	return array_map( 'intval', $years );
}

/**
 * Year filter chips for the current category archive. Prints nothing when
 * the category has posts in only one year.
 */
function mfm_year_filter(): void {
	if ( ! is_category() ) {
		return;
	}
	$term  = get_queried_object();
	$years = mfm_category_years( (int) $term->term_id );
	if ( count( $years ) < 2 ) {
		return;
	}
	$base    = get_term_link( $term );
	$current = (int) get_query_var( 'year' );

	echo '<nav class="chips" aria-label="' . esc_attr__( 'Filter by year', 'mfm-theme' ) . '">';
	printf(
		'<a class="chip" href="%s"%s>%s</a>',
		esc_url( $base ),
		$current ? '' : ' aria-current="true"',
		esc_html__( 'All', 'mfm-theme' )
	);
	foreach ( $years as $y ) {
		printf(
			'<a class="chip" href="%s"%s>%d</a>',
			esc_url( add_query_arg( 'year', $y, $base ) ),
			$current === $y ? ' aria-current="true"' : '',
			$y
		);
	}
	echo '</nav>';
}

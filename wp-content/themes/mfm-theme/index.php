<?php
/**
 * Fallback for anything without a more specific template (blog home, search).
 */

defined( 'ABSPATH' ) || exit;

get_header();
?>
<main id="content" class="site-main">
	<?php if ( is_search() ) : ?>
		<header class="archive-header">
			<h1 class="archive-title">
				<?php printf( esc_html__( 'Results for “%s”', 'mfm-theme' ), esc_html( get_search_query() ) ); ?>
			</h1>
		</header>
	<?php elseif ( is_home() && ! is_front_page() ) : ?>
		<header class="archive-header">
			<h1 class="archive-title"><?php single_post_title(); ?></h1>
		</header>
	<?php endif; ?>

	<?php get_template_part( 'template-parts/post-list' ); ?>
</main>
<?php
get_footer();

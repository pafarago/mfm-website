<?php
/**
 * Archives (News and any other category, tag or date): title, year filter,
 * then posts grouped under month headings.
 */

defined( 'ABSPATH' ) || exit;

get_header();
?>
<main id="content" class="site-main">
	<header class="archive-header">
		<h1 class="archive-title"><?php echo esc_html( wp_strip_all_tags( get_the_archive_title() ) ); ?></h1>
		<?php the_archive_description( '<div class="archive-description">', '</div>' ); ?>
		<?php mfm_year_filter(); ?>
	</header>

	<?php get_template_part( 'template-parts/post-list' ); ?>
</main>
<?php
get_footer();

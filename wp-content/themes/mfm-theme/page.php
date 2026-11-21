<?php
/**
 * A page: title and content in one card.
 */

defined( 'ABSPATH' ) || exit;

get_header();
?>
<main id="content" class="site-main">
	<?php while ( have_posts() ) : the_post(); ?>
		<article id="post-<?php the_ID(); ?>" <?php post_class( 'card card--page' ); ?>>
			<?php if ( get_the_title() !== '' ) : ?>
				<h1 class="entry-title"><?php the_title(); ?></h1>
			<?php endif; ?>
			<div class="entry-content">
				<?php the_content(); ?>
				<?php wp_link_pages(); ?>
			</div>
		</article>
	<?php endwhile; ?>
</main>
<?php
get_footer();

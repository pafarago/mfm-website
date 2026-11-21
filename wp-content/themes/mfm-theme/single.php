<?php
/**
 * A single post (e.g. one newsletter issue).
 */

defined( 'ABSPATH' ) || exit;

get_header();
?>
<main id="content" class="site-main">
	<?php while ( have_posts() ) : the_post(); ?>
		<?php mfm_back_link( 'top' ); ?>

		<article id="post-<?php the_ID(); ?>" <?php post_class( 'card card--post' ); ?>>
			<header class="entry-header">
				<?php echo mfm_post_date( 'l, F j, Y' ); ?>
				<h1 class="entry-title"><?php the_title(); ?></h1>
			</header>
			<div class="entry-content">
				<?php the_content(); ?>
				<?php wp_link_pages(); ?>
			</div>
		</article>

		<?php
		the_post_navigation( [
			'in_same_term' => true,
			'prev_text'    => '<span class="post-nav__label">' . esc_html__( 'Previous', 'mfm-theme' ) . '</span><span class="post-nav__title">%title</span>',
			'next_text'    => '<span class="post-nav__label">' . esc_html__( 'Next', 'mfm-theme' ) . '</span><span class="post-nav__title">%title</span>',
			'class'        => 'post-nav',
		] );
		?>

		<?php mfm_back_link( 'bottom' ); ?>
	<?php endwhile; ?>
</main>
<?php
get_footer();

<?php
/**
 * The main query as cards grouped under month headings, with pagination.
 */

defined( 'ABSPATH' ) || exit;

if ( ! have_posts() ) : ?>
	<div class="card">
		<p><?php esc_html_e( 'Nothing has been posted here yet.', 'mfm-theme' ); ?></p>
	</div>
	<?php
	return;
endif;

$month = '';
?>
<div class="post-list">
	<?php
	while ( have_posts() ) :
		the_post();
		$this_month = get_the_date( 'F Y' );
		if ( $this_month !== $month ) :
			$month = $this_month;
			?>
			<h2 class="post-list__month"><?php echo esc_html( $month ); ?></h2>
		<?php endif; ?>

		<article id="post-<?php the_ID(); ?>" <?php post_class( 'card post-card' ); ?>>
			<?php echo mfm_post_date(); ?>
			<h3 class="post-card__title"><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h3>
			<div class="post-card__excerpt"><?php the_excerpt(); ?></div>
			<a class="post-card__more" href="<?php the_permalink(); ?>">
				<?php esc_html_e( 'Read more', 'mfm-theme' ); ?><span class="screen-reader-text">: <?php the_title(); ?></span>
			</a>
		</article>
	<?php endwhile; ?>
</div>

<?php
the_posts_pagination( [
	'mid_size'           => 1,
	'prev_text'          => __( 'Newer', 'mfm-theme' ),
	'next_text'          => __( 'Older', 'mfm-theme' ),
	'screen_reader_text' => __( 'More posts', 'mfm-theme' ),
	'class'              => 'pagination',
] );

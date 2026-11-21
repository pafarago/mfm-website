<?php
/**
 * Site footer.
 */

defined( 'ABSPATH' ) || exit;
?>
<footer class="site-footer">
	<div class="site-footer__inner">
		<p>&copy; <?php echo esc_html( wp_date( 'Y' ) ); ?> <?php bloginfo( 'name' ); ?></p>
		<?php if ( mfm_option( 'mfm_address_line' ) ) : ?>
			<p><?php echo esc_html( mfm_option( 'mfm_address_line' ) ); ?></p>
		<?php endif; ?>
		<?php
		if ( has_nav_menu( 'footer' ) ) {
			wp_nav_menu( [
				'theme_location'  => 'footer',
				'container'       => 'nav',
				'container_class' => 'footer-links',
				'container_aria_label' => __( 'Footer links', 'mfm-theme' ),
				'menu_class'      => 'footer-links__list',
				'depth'           => 1,
				'fallback_cb'     => false,
			] );
		}
		?>
	</div>
</footer>
<?php wp_footer(); ?>
</body>
</html>

<?php
/**
 * /docs/feedback/ inside the active theme's header and footer, in the same
 * card as the folder pages.
 */

defined( 'ABSPATH' ) || exit;

get_header();
?>
<main id="content" class="site-main">
	<article class="card card--page content-box">
		<?php echo MFM_Docs_Feedback::render(); // phpcs:ignore WordPress.Security.EscapeOutput -- escaped in the renderer ?>
	</article>
</main>
<?php
get_footer();

<?php
/**
 * Page not found.
 */

defined( 'ABSPATH' ) || exit;

get_header();
?>
<main id="content" class="site-main">
	<article class="card card--page">
		<h1 class="entry-title"><?php esc_html_e( 'Page not found', 'mfm-theme' ); ?></h1>
		<div class="entry-content">
			<p><?php esc_html_e( 'That page may have moved when the website was updated. Try the menu, or start from the home page.', 'mfm-theme' ); ?></p>
			<p><a class="button" href="<?php echo esc_url( home_url( '/' ) ); ?>"><?php esc_html_e( 'Go to the home page', 'mfm-theme' ); ?></a></p>
		</div>
	</article>
</main>
<?php
get_footer();

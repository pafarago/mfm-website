<?php
/**
 * A /docs/ folder page inside the active theme's header and footer.
 * Uses mfm-theme's card markup; also reads fine under other themes.
 */

defined( 'ABSPATH' ) || exit;

$mfm_docs_page = MFM_Docs_Front::current_page();

get_header();
?>
<main id="content" class="site-main">
	<article class="card card--page content-box">
		<?php echo MFM_Docs_Render::folder( $mfm_docs_page['folder'] ); // phpcs:ignore WordPress.Security.EscapeOutput -- escaped in the renderer ?>
	</article>
</main>
<?php
get_footer();

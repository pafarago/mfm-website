<?php
/**
 * Stand-alone "back soon" page served with HTTP 503 (see inc/maintenance.php).
 * Deliberately avoids wp_head() so no plugin output or menu leaks through.
 */

defined( 'ABSPATH' ) || exit;

$name = get_bloginfo( 'name' );
$css  = MFM_THEME_URI . '/assets/css/theme.css?ver=' . mfm_asset_version( 'assets/css/theme.css' );
?><!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo( 'charset' ); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title><?php echo esc_html( $name ); ?></title>
<link rel="stylesheet" href="<?php echo esc_url( $css ); ?>">
</head>
<body class="maintenance">
<main id="content" class="site-main">
	<article class="card card--page maintenance__card">
		<img class="maintenance__logo" src="<?php echo esc_url( MFM_THEME_URI . '/assets/images/logo.png' ); ?>" width="509" height="172" alt="<?php echo esc_attr( $name ); ?>">
		<img class="maintenance__sign" src="<?php echo esc_url( MFM_THEME_URI . '/assets/images/maintenance-sign.jpg' ); ?>" width="1200" height="800" alt="">
		<p class="maintenance__msg"><?php echo esc_html( mfm_option( 'mfm_maintenance_msg' ) ); ?></p>
		<?php if ( mfm_option( 'mfm_worship_line' ) || mfm_option( 'mfm_address_line' ) ) : ?>
			<p class="maintenance__info">
				<strong><?php echo esc_html( mfm_option( 'mfm_worship_line' ) ); ?></strong><br>
				<?php echo esc_html( mfm_option( 'mfm_address_line' ) ); ?>
			</p>
		<?php endif; ?>
	</article>
</main>
</body>
</html>

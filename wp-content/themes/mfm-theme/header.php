<?php
/**
 * Site header: logo, menu button (phones) and the one copy of the main menu.
 */

defined( 'ABSPATH' ) || exit;
?><!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo( 'charset' ); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>
<a class="skip-link" href="#content"><?php esc_html_e( 'Skip to content', 'mfm-theme' ); ?></a>

<header class="site-header">
	<div class="site-header__inner">
		<?php mfm_logo(); ?>

		<button type="button" class="nav-open" aria-expanded="false" aria-controls="nav-panel">
			<?php echo mfm_icon( 'menu' ); ?>
			<span class="nav-open__label"><?php esc_html_e( 'Menu', 'mfm-theme' ); ?></span>
		</button>

		<nav class="site-nav" id="site-nav" aria-label="<?php esc_attr_e( 'Main menu', 'mfm-theme' ); ?>">
			<div class="nav-backdrop"></div>
			<div class="nav-panel" id="nav-panel">
				<div class="nav-panel__head">
					<span class="nav-panel__label"><?php esc_html_e( 'Menu', 'mfm-theme' ); ?></span>
					<button type="button" class="nav-close" aria-label="<?php esc_attr_e( 'Close menu', 'mfm-theme' ); ?>"><?php echo mfm_icon( 'close' ); ?></button>
				</div>

				<?php mfm_primary_menu(); ?>

				<?php
				$worship = mfm_option( 'mfm_worship_line' );
				$address = mfm_option( 'mfm_address_line' );
				if ( $worship || $address ) :
					?>
					<p class="nav-panel__foot">
						<?php if ( $worship ) : ?><strong><?php echo esc_html( $worship ); ?></strong><?php endif; ?>
						<?php if ( $worship && $address ) : ?><br><?php endif; ?>
						<?php echo esc_html( $address ); ?>
					</p>
				<?php endif; ?>
			</div>
		</nav>
	</div>
</header>

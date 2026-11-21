<?php
/**
 * MFM Theme bootstrap. Each concern lives in its own file under inc/.
 */

defined( 'ABSPATH' ) || exit;

define( 'MFM_THEME_DIR', get_template_directory() );
define( 'MFM_THEME_URI', get_template_directory_uri() );

require MFM_THEME_DIR . '/inc/setup.php';
require MFM_THEME_DIR . '/inc/assets.php';
require MFM_THEME_DIR . '/inc/options.php';
require MFM_THEME_DIR . '/inc/class-mfm-nav-walker.php';
require MFM_THEME_DIR . '/inc/template-tags.php';
require MFM_THEME_DIR . '/inc/archive.php';
require MFM_THEME_DIR . '/inc/maintenance.php';

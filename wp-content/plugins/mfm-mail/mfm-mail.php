<?php
/**
 * Plugin Name:       MFM Mail
 * Description:       Sends all WordPress email through the Gmail API, from records@midlothianfriends.org.
 * Version:           2.0.0
 * Requires at least: 6.4
 * Requires PHP:      8.1
 * Author:            Midlothian Friends Meeting
 * License:           GPL-2.0-or-later
 *
 * DigitalOcean blocks the mail ports (25, 465, 587) on droplets, so mail
 * leaves over HTTPS instead: wp_mail() builds each message as usual, and
 * MFM Mail hands the finished message to the Gmail API, signed in with the
 * mfm-docs service account acting as admin@ (domain-wide delegation, scope
 * gmail.send only). Gmail sends it From records@ (on admin@'s "Send mail as"
 * list) and adds the DKIM signature, so SPF, DKIM and DMARC pass.
 *
 * Every message is sent From records@. If a plugin or form set some other
 * From (a visitor's address, say), that address becomes the Reply-To, so
 * "Reply" still goes to the right person.
 *
 * Any setting can be overridden in wp-config.php, e.g.
 *   define( 'MFM_MAIL_FROM', 'admin@midlothianfriends.org' );
 *
 * Test from the shell:
 *   wp mfm-mail test you@gmail.com            send a test message
 *   wp mfm-mail test you@gmail.com --debug    also show each step
 */

defined( 'ABSPATH' ) || exit;

defined( 'MFM_MAIL_FROM' )      || define( 'MFM_MAIL_FROM', 'records@midlothianfriends.org' );
defined( 'MFM_MAIL_FROM_NAME' ) || define( 'MFM_MAIL_FROM_NAME', 'Midlothian Friends Meeting' );
// The Workspace user Gmail sends as; MFM_MAIL_FROM must be this user's own
// address or on their "Send mail as" list.
defined( 'MFM_MAIL_ACT_AS' )    || define( 'MFM_MAIL_ACT_AS', 'admin@midlothianfriends.org' );
// The same key file mfm-docs uses (root:www-data, mode 640, outside the web root).
defined( 'MFM_MAIL_KEY_FILE' )  || define( 'MFM_MAIL_KEY_FILE', '/var/opt/GoogleAPI/google-service-account.json' );

require_once __DIR__ . '/includes/class-mfm-mail-gmail.php';

/** Set by `wp mfm-mail test --debug` to print each step. */
$GLOBALS['mfm_mail_debug'] = false;

/**
 * Make sure wp_mail() uses our mailer. pre_wp_mail runs at the start of every
 * wp_mail() call, before WordPress creates its own PHPMailer, so WordPress
 * finds ours and uses it. Returning null lets wp_mail() carry on as usual.
 */
add_filter( 'pre_wp_mail', 'mfm_mail_install_mailer', 1 );
function mfm_mail_install_mailer( $short_circuit ) {
	global $phpmailer;
	if ( null === $short_circuit && ! ( $phpmailer instanceof MFM_Mail_Mailer ) ) {
		require_once ABSPATH . WPINC . '/PHPMailer/PHPMailer.php';
		require_once ABSPATH . WPINC . '/PHPMailer/Exception.php';
		require_once __DIR__ . '/includes/class-mfm-mail-mailer.php';
		$phpmailer = new MFM_Mail_Mailer( true );
		// Same address check WordPress sets on its own mailer.
		$phpmailer::$validator = static function ( $email ) {
			return (bool) is_email( $email );
		};
	}
	return $short_circuit;
}

add_action( 'phpmailer_init', 'mfm_mail_configure' );
/**
 * @param PHPMailer\PHPMailer\PHPMailer $mailer
 */
function mfm_mail_configure( $mailer ): void {
	// What the caller asked for, before we replace it.
	$given_from = (string) $mailer->From;
	$given_name = (string) $mailer->FromName;

	$is_ours    = 0 === strcasecmp( $given_from, MFM_MAIL_FROM );
	$is_default = 0 === stripos( $given_from, 'wordpress@' );
	if ( '' !== $given_from && ! $is_ours && ! $is_default && ! $mailer->getReplyToAddresses() ) {
		$mailer->addReplyTo( $given_from, 'WordPress' === $given_name ? '' : $given_name );
	}

	$mailer->setFrom( MFM_MAIL_FROM, MFM_MAIL_FROM_NAME, false );
	$mailer->Sender = MFM_MAIL_FROM;

	// Build the message as for sendmail, so To, Subject and Bcc are in the
	// headers we hand to Gmail (Gmail delivers to Bcc and then drops that
	// header). Nothing is passed to a sendmail program: our postSend() sends.
	$mailer->Mailer = 'sendmail';
}

// Failures go to the PHP error log, so a silent "password reset never came"
// leaves a trace: sudo grep mfm-mail /var/log/apache2/error.log (or the
// PHP-FPM log).
add_action( 'wp_mail_failed', static function ( WP_Error $error ): void {
	$data = $error->get_error_data();
	$to   = is_array( $data ) && isset( $data['to'] ) ? implode( ', ', (array) $data['to'] ) : '?';
	error_log( sprintf( 'mfm-mail: sending to %s failed: %s', $to, $error->get_error_message() ) );
} );

if ( defined( 'WP_CLI' ) && WP_CLI ) {
	/**
	 * Send a test message through the Gmail API.
	 *
	 * ## OPTIONS
	 *
	 * [<to>]
	 * : Address to send to. Default: the site's admin email.
	 *
	 * [--debug]
	 * : Show the sign-in and send steps and Google's answers.
	 *
	 * @param array<int,string>    $args
	 * @param array<string,string> $assoc
	 */
	WP_CLI::add_command( 'mfm-mail test', static function ( array $args, array $assoc ): void {
		$to = $args[0] ?? (string) get_option( 'admin_email' );
		if ( ! is_email( $to ) ) {
			WP_CLI::error( "Not an email address: $to" );
		}
		$GLOBALS['mfm_mail_debug'] = isset( $assoc['debug'] );

		$failure = '';
		add_action( 'wp_mail_failed', static function ( WP_Error $e ) use ( &$failure ): void {
			$failure = $e->get_error_message();
		} );

		$body = sprintf(
			"Test message from %s, sent %s through the Gmail API as %s, acting as %s.\n\n" .
			"In Gmail, open the message, choose Show original, and check SPF, DKIM and DMARC all say PASS.\n",
			home_url(),
			wp_date( 'D j M Y H:i T' ),
			MFM_MAIL_FROM,
			MFM_MAIL_ACT_AS
		);

		if ( wp_mail( $to, 'MFM website: mail test', $body ) ) {
			WP_CLI::success( "Sent to $to from " . MFM_MAIL_FROM . '.' );
		} else {
			WP_CLI::error( 'Not sent: ' . ( '' !== $failure ? $failure : 'unknown error' ) . ' (try --debug)' );
		}
	} );
}

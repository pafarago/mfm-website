<?php
/**
 * Plugin Name:       MFM Mail
 * Description:       Sends all WordPress email through the Google Workspace SMTP relay, from records@midlothianfriends.org.
 * Version:           1.0.0
 * Requires at least: 6.4
 * Requires PHP:      8.1
 * Author:            Midlothian Friends Meeting
 * License:           GPL-2.0-or-later
 *
 * The relay accepts mail from the droplet's IP address (Admin console →
 * Apps → Google Workspace → Gmail → Routing → SMTP relay service), so there
 * is no password here. Google signs the mail with the domain's DKIM key, and
 * SPF passes because it leaves from Google's servers, so DMARC passes.
 *
 * Every message is sent From records@. If a plugin or form set some other
 * From (a visitor's address, say), that address becomes the Reply-To, so
 * "Reply" still goes to the right person and the relay never sees a From
 * outside the domain, which it would refuse.
 *
 * Any setting can be overridden in wp-config.php, e.g.
 *   define( 'MFM_MAIL_FROM', 'admin@midlothianfriends.org' );
 *
 * Test from the shell:
 *   wp mfm-mail test you@gmail.com            send a test message
 *   wp mfm-mail test you@gmail.com --debug    also show the SMTP conversation
 */

defined( 'ABSPATH' ) || exit;

defined( 'MFM_MAIL_FROM' )      || define( 'MFM_MAIL_FROM', 'records@midlothianfriends.org' );
defined( 'MFM_MAIL_FROM_NAME' ) || define( 'MFM_MAIL_FROM_NAME', 'Midlothian Friends Meeting' );
defined( 'MFM_MAIL_HOST' )      || define( 'MFM_MAIL_HOST', 'smtp-relay.gmail.com' );
defined( 'MFM_MAIL_PORT' )      || define( 'MFM_MAIL_PORT', 587 );
// The name the droplet gives itself when it connects. Google's relay turns
// away "localhost" and other names that aren't real hostnames.
defined( 'MFM_MAIL_HELO' )      || define( 'MFM_MAIL_HELO', 'midlothianfriends.org' );

/** Set by `wp mfm-mail test --debug` to print the SMTP conversation. */
$GLOBALS['mfm_mail_debug'] = false;

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

	// From header and envelope sender (where bounces go) are both records@.
	$mailer->setFrom( MFM_MAIL_FROM, MFM_MAIL_FROM_NAME, false );
	$mailer->Sender = MFM_MAIL_FROM;

	$mailer->isSMTP();
	$mailer->Host        = MFM_MAIL_HOST;
	$mailer->Port        = (int) MFM_MAIL_PORT;
	$mailer->SMTPSecure  = 'tls';   // STARTTLS on 587
	$mailer->SMTPAutoTLS = true;
	$mailer->SMTPAuth    = false;   // the relay checks the droplet's IP instead
	$mailer->Hostname    = MFM_MAIL_HELO;
	$mailer->Helo        = MFM_MAIL_HELO;
	$mailer->Timeout     = 15;

	if ( $GLOBALS['mfm_mail_debug'] ) {
		$mailer->SMTPDebug   = 2;
		$mailer->Debugoutput = static function ( $line ) {
			fwrite( STDERR, rtrim( (string) $line ) . "\n" );
		};
	}
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
	 * Send a test message through the relay.
	 *
	 * ## OPTIONS
	 *
	 * [<to>]
	 * : Address to send to. Default: the site's admin email.
	 *
	 * [--debug]
	 * : Show the SMTP conversation with the relay.
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
			"Test message from %s, sent %s through %s:%d as %s.\n\n" .
			"In Gmail, open the message, choose Show original, and check SPF, DKIM and DMARC all say PASS.\n",
			home_url(),
			wp_date( 'D j M Y H:i T' ),
			MFM_MAIL_HOST,
			(int) MFM_MAIL_PORT,
			MFM_MAIL_FROM
		);

		if ( wp_mail( $to, 'MFM website: mail test', $body ) ) {
			WP_CLI::success( "Sent to $to from " . MFM_MAIL_FROM . '.' );
		} else {
			WP_CLI::error( 'Not sent: ' . ( '' !== $failure ? $failure : 'unknown error' ) . ' (try --debug)' );
		}
	} );
}

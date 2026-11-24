<?php
/**
 * WordPress's own mailer (PHPMailer), with the last step replaced.
 *
 * wp_mail() keeps building each message exactly as before: HTML, attachments,
 * Cc, Bcc, headers set by plugins. Only the hand-over changes: instead of
 * PHP's mail() or an SMTP server, the finished message goes to the Gmail API.
 *
 * Loaded only after PHPMailer itself, from mfm_mail_install_mailer().
 */

defined( 'ABSPATH' ) || exit;

class MFM_Mail_Mailer extends PHPMailer\PHPMailer\PHPMailer {

	/**
	 * Called by send() once the message is built.
	 *
	 * @return bool
	 * @throws PHPMailer\PHPMailer\Exception when exceptions are on (as in wp_mail).
	 */
	public function postSend() {
		try {
			MFM_Mail_Gmail::send( $this->getSentMIMEMessage() );
			return true;
		} catch ( Throwable $e ) {
			$this->setError( $e->getMessage() );
			if ( $this->exceptions ) {
				throw new PHPMailer\PHPMailer\Exception( $e->getMessage() );
			}
			return false;
		}
	}
}

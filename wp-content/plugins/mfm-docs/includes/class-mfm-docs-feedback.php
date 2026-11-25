<?php
/**
 * "Send feedback to MFM": a small form at /docs/feedback/ that emails the
 * address in Settings → MFM Docs (records@ by default) through wp_mail(), so
 * MFM Mail delivers it. No mailto: links, so the address is never shown.
 *
 * Spam guards: a WordPress nonce, a hidden field people never fill in, a
 * minimum of 3 seconds between showing the form and sending it, and at most
 * 5 messages an hour from one address.
 */

defined( 'ABSPATH' ) || exit;

class MFM_Docs_Feedback {

	const ACTION   = 'mfm_docs_feedback';
	const MAX_LEN  = 5000;
	const PER_HOUR = 5;

	private static bool $is_page = false;

	public static function init(): void {
		add_action( 'init', function () {
			add_rewrite_rule( '^docs/feedback/?$', 'index.php?mfm_docs_feedback=1', 'top' );
		}, 5 ); // before the /docs/<entry>/ rules
		add_filter( 'query_vars', fn( $v ) => array_merge( $v, [ 'mfm_docs_feedback' ] ) );
		add_action( 'parse_request', function ( WP $wp ) {
			self::$is_page = ! empty( $wp->query_vars['mfm_docs_feedback'] );
		} );
		add_filter( 'pre_handle_404', fn( $handled ) => self::$is_page ? true : $handled );
		add_filter( 'template_include', [ __CLASS__, 'template' ], 99 );
		add_filter( 'document_title_parts', function ( $parts ) {
			if ( self::$is_page ) {
				$parts['title'] = __( 'Send feedback to MFM', 'mfm-docs' );
			}
			return $parts;
		} );
		add_filter( 'body_class', fn( $c ) => self::$is_page ? array_merge( $c, [ 'mfm-docs-page' ] ) : $c );
		add_action( 'admin_post_nopriv_' . self::ACTION, [ __CLASS__, 'handle' ] );
		add_action( 'admin_post_' . self::ACTION, [ __CLASS__, 'handle' ] );
	}

	/** Address of the form, remembering which page the visitor came from. */
	public static function url( string $from = '' ): string {
		$url = home_url( user_trailingslashit( 'docs/feedback' ) );
		return $from ? add_query_arg( 'from', rawurlencode( $from ), $url ) : $url;
	}

	/** The page to go back to: the "from" address if it is on this site, else Home. */
	public static function back_url(): string {
		$from = isset( $_REQUEST['from'] ) ? esc_url_raw( wp_unslash( (string) $_REQUEST['from'] ) ) : '';
		return wp_validate_redirect( $from, home_url( '/' ) );
	}

	public static function template( string $template ): string {
		if ( ! self::$is_page ) {
			return $template;
		}
		status_header( 200 );
		global $wp_query;
		$wp_query->is_404 = false;
		return MFM_DOCS_DIR . '/templates/feedback-page.php';
	}

	/** The form (or the thank-you note) for the feedback page. */
	public static function render(): string {
		$back  = self::back_url();
		$state = isset( $_GET['sent'] ) ? 'sent' : sanitize_key( (string) ( $_GET['error'] ?? '' ) );

		ob_start();
		echo '<div class="mfm-docs mfm-docs--feedback">';
		echo '<div class="mfm-docs__head"><h1 class="mfm-docs__title">' . esc_html__( 'Send feedback to MFM', 'mfm-docs' ) . '</h1></div>';

		if ( 'sent' === $state ) {
			echo '<p class="mfm-docs__notice mfm-docs__notice--ok">' . esc_html__( 'Thank you. Your message has been sent.', 'mfm-docs' ) . '</p>';
			printf( '<p><a class="mfm-docs__back" href="%s">← %s</a></p>', esc_url( $back ), esc_html__( 'Back to where you were', 'mfm-docs' ) );
			echo '</div>';
			return (string) ob_get_clean();
		}

		$errors = [
			'empty'   => __( 'Please write a message before sending.', 'mfm-docs' ),
			'email'   => __( 'That email address doesn’t look right. Leave it empty if you’d rather not give one.', 'mfm-docs' ),
			'busy'    => __( 'Too many messages were sent from here in the last hour. Please try again later.', 'mfm-docs' ),
			'expired' => __( 'The form had been open too long, or was sent too quickly. Please try again.', 'mfm-docs' ),
			'mail'    => __( 'Sorry, the message could not be sent just now. Please try again later.', 'mfm-docs' ),
		];
		if ( isset( $errors[ $state ] ) ) {
			echo '<p class="mfm-docs__notice mfm-docs__notice--error" role="alert">' . esc_html( $errors[ $state ] ) . '</p>';
		}

		echo '<p>' . esc_html__( 'Questions, corrections or suggestions about the website are welcome. Your message goes to Midlothian Friends Meeting’s records team.', 'mfm-docs' ) . '</p>';
		?>
		<form class="mfm-docs__form" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="<?php echo esc_attr( self::ACTION ); ?>">
			<input type="hidden" name="from" value="<?php echo esc_attr( $back ); ?>">
			<input type="hidden" name="t" value="<?php echo esc_attr( self::stamp() ); ?>">
			<?php wp_nonce_field( self::ACTION, '_mfmnonce' ); ?>
			<p class="mfm-docs__hp" aria-hidden="true">
				<label>Leave this empty <input type="text" name="website" value="" tabindex="-1" autocomplete="off"></label>
			</p>
			<p>
				<label for="mfm-fb-name"><?php esc_html_e( 'Your name (optional)', 'mfm-docs' ); ?></label>
				<input id="mfm-fb-name" type="text" name="fb_name" maxlength="100" autocomplete="name">
			</p>
			<p>
				<label for="mfm-fb-email"><?php esc_html_e( 'Your email (optional, if you’d like a reply)', 'mfm-docs' ); ?></label>
				<input id="mfm-fb-email" type="email" name="fb_email" maxlength="200" autocomplete="email">
			</p>
			<p>
				<label for="mfm-fb-message"><?php esc_html_e( 'Message', 'mfm-docs' ); ?></label>
				<textarea id="mfm-fb-message" name="fb_message" rows="7" maxlength="<?php echo (int) self::MAX_LEN; ?>" required></textarea>
			</p>
			<p class="mfm-docs__form-actions">
				<button type="submit" class="mfm-docs__button"><?php esc_html_e( 'Send', 'mfm-docs' ); ?></button>
				<a class="mfm-docs__back" href="<?php echo esc_url( $back ); ?>"><?php esc_html_e( 'Cancel', 'mfm-docs' ); ?></a>
			</p>
		</form>
		<?php
		echo '</div>';
		return (string) ob_get_clean();
	}

	/** Process a submitted form, then send the visitor back to the page with the result. */
	public static function handle(): void {
		$back = self::back_url();
		$go   = static function ( string $result ) use ( $back ): void {
			$args = 'sent' === $result ? [ 'sent' => 1 ] : [ 'error' => $result ];
			wp_safe_redirect( add_query_arg( $args + [ 'from' => rawurlencode( $back ) ], self::url() ) );
			exit;
		};

		$nonce_ok = wp_verify_nonce( (string) ( $_POST['_mfmnonce'] ?? '' ), self::ACTION );
		if ( ! $nonce_ok || ! self::stamp_ok( (string) ( $_POST['t'] ?? '' ) ) ) {
			$go( 'expired' );
		}
		// Filled-in hidden field: a robot. Pretend it worked.
		if ( '' !== trim( (string) ( $_POST['website'] ?? '' ) ) ) {
			$go( 'sent' );
		}

		$name    = sanitize_text_field( wp_unslash( (string) ( $_POST['fb_name'] ?? '' ) ) );
		$email   = sanitize_email( wp_unslash( (string) ( $_POST['fb_email'] ?? '' ) ) );
		$message = trim( sanitize_textarea_field( wp_unslash( (string) ( $_POST['fb_message'] ?? '' ) ) ) );
		$raw_email = trim( (string) ( $_POST['fb_email'] ?? '' ) );

		if ( '' === $message ) {
			$go( 'empty' );
		}
		if ( '' !== $raw_email && ! is_email( $email ) ) {
			$go( 'email' );
		}

		$ip    = (string) ( $_SERVER['REMOTE_ADDR'] ?? '' );
		$key   = 'mfm_docs_fb_' . md5( $ip );
		$count = (int) get_transient( $key );
		if ( $count >= self::PER_HOUR ) {
			$go( 'busy' );
		}
		set_transient( $key, $count + 1, HOUR_IN_SECONDS );

		$message = mb_substr( $message, 0, self::MAX_LEN );
		$to      = (string) ( MFM_Docs_Settings::get()['feedback_to'] ?? '' );
		$page    = wp_make_link_relative( $back ) ?: '/';
		$subject = sprintf( 'Website feedback (%s)', $page );
		$body    = sprintf(
			"%s\n\n-- \nFrom: %s\nEmail: %s\nPage: %s\nSent: %s\nBrowser: %s\n",
			$message,
			'' !== $name ? $name : '(not given)',
			'' !== $email ? $email : '(not given)',
			$back,
			wp_date( 'D j M Y, g:i a' ),
			sanitize_text_field( (string) ( $_SERVER['HTTP_USER_AGENT'] ?? '' ) )
		);
		$headers = [];
		if ( '' !== $email ) {
			$headers[] = 'Reply-To: ' . ( '' !== $name ? str_replace( [ '"', "\r", "\n" ], '', $name ) . ' <' . $email . '>' : $email );
		}

		if ( ! is_email( $to ) || ! wp_mail( $to, $subject, $body, $headers ) ) {
			MFM_Docs_Log::error( 'Feedback from ' . $page . ' could not be sent.' );
			$go( 'mail' );
		}
		MFM_Docs_Log::info( 'Feedback sent from ' . $page . '.' );
		$go( 'sent' );
	}

	/** "<time>.<signature>", so the form's age can be checked without a session. */
	private static function stamp(): string {
		$t = (string) time();
		return $t . '.' . substr( wp_hash( 'mfm-fb-' . $t, 'nonce' ), 0, 16 );
	}

	private static function stamp_ok( string $stamp ): bool {
		[ $t, $sig ] = array_pad( explode( '.', $stamp, 2 ), 2, '' );
		if ( ! ctype_digit( $t ) || ! hash_equals( substr( wp_hash( 'mfm-fb-' . $t, 'nonce' ), 0, 16 ), $sig ) ) {
			return false;
		}
		$age = time() - (int) $t;
		return $age >= 3 && $age <= DAY_IN_SECONDS;
	}
}

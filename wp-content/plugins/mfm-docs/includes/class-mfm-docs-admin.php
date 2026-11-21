<?php
/**
 * Settings → MFM Docs: status, entry folders, Refresh / Clear cache, log.
 */

defined( 'ABSPATH' ) || exit;

class MFM_Docs_Admin {

	const SLUG = 'mfm-docs';

	public static function init(): void {
		add_action( 'admin_menu', function () {
			add_options_page( 'MFM Docs', 'MFM Docs', 'manage_options', self::SLUG, [ __CLASS__, 'page' ] );
		} );
		add_action( 'admin_init', function () {
			register_setting( 'mfm_docs', MFM_Docs_Settings::OPTION, [
				'type'              => 'array',
				'sanitize_callback' => [ 'MFM_Docs_Settings', 'sanitize' ],
			] );
		} );
		add_action( 'admin_post_mfm_docs_refresh', [ __CLASS__, 'refresh' ] );
		add_action( 'admin_post_mfm_docs_clear', [ __CLASS__, 'clear' ] );
		add_filter( 'plugin_action_links_' . plugin_basename( MFM_DOCS_FILE ), function ( $links ) {
			array_unshift( $links, '<a href="' . esc_url( admin_url( 'options-general.php?page=' . self::SLUG ) ) . '">' . esc_html__( 'Settings', 'mfm-docs' ) . '</a>' );
			return $links;
		} );
	}

	public static function refresh(): void {
		self::guard( 'mfm_docs_refresh' );
		$r   = MFM_Docs_Library::sync( 120 );
		$msg = $r['ok']
			? sprintf( 'Refreshed: %d folders, %d documents, %d copies prepared.', $r['folders'], $r['files'], $r['converted'] )
			: 'Refresh failed: ' . $r['error'];
		self::back( $msg, $r['ok'] ? 'success' : 'error' );
	}

	public static function clear(): void {
		self::guard( 'mfm_docs_clear' );
		$n = MFM_Docs_Cache::clear();
		self::back( sprintf( 'Removed %d cached copies. They will be rebuilt on the next refresh or when opened.', $n ), 'success' );
	}

	private static function guard( string $action ): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'Not allowed.' );
		}
		check_admin_referer( $action );
	}

	private static function back( string $msg, string $type ): void {
		set_transient( 'mfm_docs_notice_' . get_current_user_id(), [ $msg, $type ], 60 );
		wp_safe_redirect( admin_url( 'options-general.php?page=' . self::SLUG ) );
		exit;
	}

	public static function page(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$notice  = get_transient( 'mfm_docs_notice_' . get_current_user_id() );
		delete_transient( 'mfm_docs_notice_' . get_current_user_id() );
		$tree    = MFM_Docs_Library::tree();
		$email   = MFM_Docs_Google::account_email();
		$stats   = MFM_Docs_Cache::stats();
		$soffice = MFM_Docs_Cache::soffice();
		$error   = (string) get_option( 'mfm_docs_last_error', '' );
		$next    = wp_next_scheduled( MFM_Docs_Library::CRON_HOOK );
		$entries = MFM_Docs_Settings::get()['entries'];
		$entries = array_merge( $entries, array_fill( 0, 2, [ 'slug' => '', 'title' => '', 'folder' => '' ] ) );
		$ok      = '<span style="color:#1e7b34">✔</span> ';
		$bad     = '<span style="color:#b42318">✖</span> ';
		?>
		<div class="wrap">
			<h1>MFM Docs</h1>
			<?php if ( $notice ) : ?>
				<div class="notice notice-<?php echo esc_attr( $notice[1] ); ?> is-dismissible"><p><?php echo esc_html( $notice[0] ); ?></p></div>
			<?php endif; ?>
			<?php settings_errors( MFM_Docs_Settings::OPTION ); ?>

			<h2>Status</h2>
			<table class="widefat striped" style="max-width:60rem">
				<tbody>
				<tr><th style="width:14rem">Google service account</th><td>
					<?php if ( $email ) : ?>
						<?php echo $ok; ?><code><?php echo esc_html( $email ); ?></code><br>
						<span class="description">Each entry folder must be shared with this address (Viewer).</span>
					<?php else : ?>
						<?php echo $bad; ?>Key file not readable: <code><?php echo esc_html( MFM_DOCS_KEY_FILE ); ?></code>
					<?php endif; ?>
				</td></tr>
				<tr><th>Cache folder</th><td>
					<?php echo MFM_Docs_Cache::writable() ? $ok : $bad; ?><code><?php echo esc_html( MFM_Docs_Cache::dir() ); ?></code>
					— <?php echo esc_html( sprintf( '%d files, %s', $stats['count'], size_format( $stats['bytes'] ) ) ); ?>
				</td></tr>
				<tr><th>LibreOffice</th><td>
					<?php echo $soffice ? $ok . '<code>' . esc_html( $soffice ) . '</code>' : $bad . 'not found (Word/Excel/PowerPoint files cannot be shown as PDF)'; ?>
				</td></tr>
				<tr><th>Last sync</th><td>
					<?php
					echo $tree['synced']
						? esc_html( sprintf( '%s ago — %d folders, %d documents', human_time_diff( $tree['synced'] ), count( $tree['folders'] ), count( $tree['files'] ) ) )
						: 'Never';
					if ( $next ) {
						echo '<br><span class="description">' . esc_html( sprintf( 'Next automatic sync in %s.', human_time_diff( $next ) ) ) . '</span>';
					}
					?>
				</td></tr>
				<?php if ( $error ) : ?>
					<tr><th>Last error</th><td><?php echo $bad . esc_html( $error ); ?></td></tr>
				<?php endif; ?>
				<tr><th>Documents cited in pages</th><td><?php echo (int) count( MFM_Docs_Library::cited() ); ?> <span class="description">([mfm_doc] and [embed-all] ids)</span></td></tr>
				</tbody>
			</table>

			<div style="display:flex;gap:.5rem;margin:1rem 0">
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="mfm_docs_refresh">
					<?php wp_nonce_field( 'mfm_docs_refresh' ); ?>
					<?php submit_button( 'Refresh documents now', 'primary', 'submit', false ); ?>
				</form>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" onsubmit="return confirm('Remove all cached PDF and Word copies?');">
					<input type="hidden" name="action" value="mfm_docs_clear">
					<?php wp_nonce_field( 'mfm_docs_clear' ); ?>
					<?php submit_button( 'Clear cache', 'secondary', 'submit', false ); ?>
				</form>
			</div>

			<h2>Entry folders</h2>
			<p class="description">Each entry is a Google Drive folder shown at <code><?php echo esc_html( home_url( '/docs/' ) ); ?>&lt;address&gt;/</code>. Paste a folder ID or its Drive link. Leave a row empty to remove it.</p>
			<form method="post" action="options.php">
				<?php settings_fields( 'mfm_docs' ); ?>
				<table class="widefat striped" style="max-width:60rem">
					<thead><tr><th>Title</th><th>Address</th><th>Drive folder ID</th><th></th></tr></thead>
					<tbody>
					<?php foreach ( $entries as $i => $e ) : $n = MFM_Docs_Settings::OPTION . "[entries][$i]"; ?>
						<tr>
							<td><input type="text" class="regular-text" style="width:100%" name="<?php echo esc_attr( $n ); ?>[title]" value="<?php echo esc_attr( $e['title'] ); ?>"></td>
							<td><input type="text" style="width:100%" name="<?php echo esc_attr( $n ); ?>[slug]" value="<?php echo esc_attr( $e['slug'] ); ?>" placeholder="e.g. handbook"></td>
							<td><input type="text" style="width:100%" name="<?php echo esc_attr( $n ); ?>[folder]" value="<?php echo esc_attr( $e['folder'] ); ?>"></td>
							<td><?php if ( $e['slug'] ) : ?><a href="<?php echo esc_url( MFM_Docs_Render::folder_url( $e['slug'] ) ); ?>" target="_blank">View</a><?php endif; ?></td>
						</tr>
					<?php endforeach; ?>
					</tbody>
				</table>
				<?php submit_button( 'Save folders' ); ?>
			</form>

			<h2>Recent activity</h2>
			<table class="widefat striped" style="max-width:60rem">
				<tbody>
				<?php foreach ( array_reverse( MFM_Docs_Log::entries() ) as $l ) : ?>
					<tr>
						<td style="width:11rem;white-space:nowrap"><?php echo esc_html( wp_date( 'M j, g:i a', $l['t'] ) ); ?></td>
						<td><?php echo ( 'error' === $l['level'] ? $bad : '' ) . esc_html( $l['msg'] ); ?></td>
					</tr>
				<?php endforeach; ?>
				<?php if ( ! MFM_Docs_Log::entries() ) : ?>
					<tr><td>Nothing yet.</td></tr>
				<?php endif; ?>
				</tbody>
			</table>
		</div>
		<?php
	}
}

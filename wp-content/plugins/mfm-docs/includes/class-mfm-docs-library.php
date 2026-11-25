<?php
/**
 * The cached picture of Drive: every folder and file under the entry folders,
 * plus files cited by [mfm_doc]/[embed-all] in published content.
 *
 * Sync (every 5 minutes by cron, or "Refresh documents") re-lists the entry
 * trees, then makes sure each document's PDF (and Word copy) is in the cache,
 * converting in the background so visitors rarely wait.
 *
 * Tree option (not autoloaded):
 *   folders: id => [name, parent, entry, sort]   (sort: from a "sort:" line in the folder's Description, or '')
 *   files:   id => [name, mime, parent, modified, version]   ("version" changes on every edit)
 *   cited:   id => true                                       (files outside the trees)
 *   synced:  unix time
 */

defined( 'ABSPATH' ) || exit;

class MFM_Docs_Library {

	const TREE_OPTION  = 'mfm_docs_tree';
	const CITED_OPTION = 'mfm_docs_cited';
	const CRON_HOOK    = 'mfm_docs_sync';
	const LOCK         = 'mfm_docs_sync_lock';

	const FOLDER = 'application/vnd.google-apps.folder';

	/** File types listed and viewable as PDF. */
	const SUPPORTED = [
		'application/pdf',
		'application/vnd.google-apps.document',
		'application/vnd.google-apps.spreadsheet',
		'application/vnd.google-apps.presentation',
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		'application/msword',
		'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		'application/vnd.ms-excel',
		'application/vnd.openxmlformats-officedocument.presentationml.presentation',
		'application/vnd.ms-powerpoint',
		'application/rtf',
		'application/vnd.oasis.opendocument.text',
	];

	/**
	 * Which file of a same-name group is opened as the PDF (lower wins).
	 * A Google Doc is the master copy, so its PDF (exported again after every
	 * edit) wins over an older PDF or Word file of the same name.
	 */
	const VIEW_RANK = [
		'application/vnd.google-apps.document' => 0,
		'application/pdf'                      => 1,
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document' => 2,
	];

	const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
	const GDOC_MIME = 'application/vnd.google-apps.document';

	public static function init(): void {
		add_filter( 'cron_schedules', function ( $s ) {
			$s['mfm_docs_5min'] = [ 'interval' => 300, 'display' => 'Every 5 minutes' ];
			return $s;
		} );
		add_action( self::CRON_HOOK, [ __CLASS__, 'sync' ] );
		add_action( 'init', [ __CLASS__, 'schedule' ] );
		add_action( 'save_post', [ __CLASS__, 'on_save_post' ], 20, 2 );
	}

	public static function schedule(): void {
		if ( ! wp_next_scheduled( self::CRON_HOOK ) ) {
			wp_schedule_event( time() + 60, 'mfm_docs_5min', self::CRON_HOOK );
		}
	}

	/* ------------------------------------------------------------- data */

	public static function tree(): array {
		$t = get_option( self::TREE_OPTION );
		return is_array( $t ) ? $t + [ 'folders' => [], 'files' => [], 'synced' => 0 ] : [ 'folders' => [], 'files' => [], 'synced' => 0 ];
	}

	public static function folder( string $id ): ?array {
		return self::tree()['folders'][ $id ] ?? null;
	}

	public static function file( string $id ): ?array {
		return self::tree()['files'][ $id ] ?? null;
	}

	/** A file may be served if it is under an entry folder or cited in content. */
	public static function is_allowed( string $id ): bool {
		$f = self::file( $id );
		return $f !== null && ( ! empty( $f['parent'] ) || isset( self::cited()[ $id ] ) );
	}

	/**
	 * A document cited in content but not synced yet (just published): look it
	 * up now so the link works straight away.
	 */
	public static function load_cited( string $id ): void {
		if ( self::file( $id ) || ! isset( self::cited()[ $id ] ) ) {
			return;
		}
		try {
			$item = MFM_Docs_Google::meta( $id );
		} catch ( RuntimeException $e ) {
			MFM_Docs_Log::error( 'Cited document ' . $id . ': ' . $e->getMessage() );
			return;
		}
		if ( ! empty( $item['trashed'] ) || ! in_array( $item['mimeType'], self::SUPPORTED, true ) ) {
			return;
		}
		$tree                  = self::tree();
		$tree['files'][ $id ]  = self::file_record( $item, '' );
		update_option( self::TREE_OPTION, $tree, false );
	}

	public static function cited(): array {
		$c = get_option( self::CITED_OPTION, [] );
		return is_array( $c ) ? $c : [];
	}

	/** Folder chain from the entry root down to $id (inclusive). */
	public static function path( string $folder_id ): array {
		$folders = self::tree()['folders'];
		$chain   = [];
		$guard   = 0;
		while ( isset( $folders[ $folder_id ] ) && $guard++ < 50 ) {
			array_unshift( $chain, [ 'id' => $folder_id ] + $folders[ $folder_id ] );
			$folder_id = (string) $folders[ $folder_id ]['parent'];
		}
		return $chain;
	}

	/**
	 * Rows to show for a folder: sub-folders and documents, in name order or
	 * in date order (see sort_mode()). Files with the same name apart from the
	 * extension become one row.
	 */
	public static function rows( string $folder_id ): array {
		$tree    = self::tree();
		$rows    = [];
		$groups  = [];

		foreach ( $tree['folders'] as $id => $f ) {
			if ( $f['parent'] === $folder_id ) {
				$rows[] = [ 'type' => 'folder', 'id' => $id, 'sort' => $f['name'], 'title' => MFM_Docs_Titles::clean( $f['name'] ), 'entry' => $f['entry'] ];
			}
		}
		foreach ( $tree['files'] as $id => $f ) {
			if ( ( $f['parent'] ?? '' ) === $folder_id ) {
				$groups[ MFM_Docs_Titles::base( $f['name'] ) ][ $id ] = $f;
			}
		}
		foreach ( $groups as $files ) {
			$row = self::doc_row( $files );
			if ( $row ) {
				$rows[] = $row;
			}
		}

		$mode = self::sort_mode( $folder_id );
		if ( 'name' === $mode ) {
			usort( $rows, fn( $a, $b ) => MFM_Docs_Titles::compare( $a['sort'], $b['sort'] ) );
			return $rows;
		}

		$desc = 'date-desc' === $mode;
		foreach ( $rows as &$r ) {
			$r['date'] = MFM_Docs_Titles::date_key( $r['sort'] );
		}
		unset( $r );
		usort( $rows, function ( $a, $b ) use ( $desc ) {
			if ( ( '' === $a['date'] ) !== ( '' === $b['date'] ) ) {
				return '' === $a['date'] ? 1 : -1; // undated last
			}
			if ( $a['date'] !== $b['date'] ) {
				return $desc ? strcmp( $b['date'], $a['date'] ) : strcmp( $a['date'], $b['date'] );
			}
			return MFM_Docs_Titles::compare( $a['sort'], $b['sort'] );
		} );
		return $rows;
	}

	/**
	 * A folder's sort mode: its own "sort:" line, else the nearest parent
	 * folder's, else 'name'.
	 */
	public static function sort_mode( string $folder_id ): string {
		$folders = self::tree()['folders'];
		$guard   = 0;
		while ( isset( $folders[ $folder_id ] ) && $guard++ < 50 ) {
			$mode = (string) ( $folders[ $folder_id ]['sort'] ?? '' );
			if ( '' !== $mode ) {
				return $mode;
			}
			$folder_id = (string) $folders[ $folder_id ]['parent'];
		}
		return 'name';
	}

	/** One document row for a single cited file. */
	public static function doc_row_for( string $id ): ?array {
		$f = self::file( $id );
		return $f ? self::doc_row( [ $id => $f ] ) : null;
	}

	/**
	 * @param array<string,array> $files same-name files
	 * @return array{type:string,id:string,word:?string,sort:string,title:string,modified:string}|null
	 */
	private static function doc_row( array $files ): ?array {
		$view = null;
		$rank = PHP_INT_MAX;
		$word = null;
		$modified = '';
		foreach ( $files as $id => $f ) {
			if ( ! in_array( $f['mime'], self::SUPPORTED, true ) ) {
				continue;
			}
			$r = self::VIEW_RANK[ $f['mime'] ] ?? 10;
			if ( $r < $rank ) {
				$rank = $r;
				$view = $id;
			}
			if ( self::DOCX_MIME === $f['mime'] || ( self::GDOC_MIME === $f['mime'] && ! $word ) ) {
				$word = $id;
			}
			$modified = max( $modified, (string) $f['modified'] );
		}
		if ( ! $view ) {
			return null;
		}
		return [
			'type'     => 'doc',
			'id'       => $view,
			'word'     => $word,
			'sort'     => $files[ $view ]['name'],
			'title'    => MFM_Docs_Titles::clean( $files[ $view ]['name'] ),
			'modified' => $modified,
		];
	}

	/** Which formats a file can be served as. */
	public static function formats( string $id ): array {
		$f = self::file( $id );
		if ( ! $f || ! in_array( $f['mime'], self::SUPPORTED, true ) ) {
			return [];
		}
		$out = [ 'pdf' ];
		if ( self::DOCX_MIME === $f['mime'] || self::GDOC_MIME === $f['mime'] ) {
			$out[] = 'docx';
		}
		return $out;
	}

	/* ------------------------------------------------------------- sync */

	/**
	 * Re-list Drive, save the tree, then fill the cache within $budget seconds.
	 *
	 * @return array{ok:bool, folders:int, files:int, converted:int, error:?string}
	 */
	public static function sync( int $budget = 45 ): array {
		$result = [ 'ok' => false, 'folders' => 0, 'files' => 0, 'converted' => 0, 'error' => null ];

		if ( get_transient( self::LOCK ) ) {
			$result['error'] = 'A sync is already running.';
			return $result;
		}
		set_transient( self::LOCK, 1, 10 * MINUTE_IN_SECONDS );
		$start = time();

		try {
			$old     = self::tree();
			$folders = [];
			$files   = [];

			foreach ( MFM_Docs_Settings::entries() as $entry ) {
				$root = $entry['folder'];
				// Fails with a clear message if the folder isn't shared with the service account.
				$meta             = MFM_Docs_Google::meta( $root );
				$folders[ $root ] = [
					'name'   => $entry['title'],
					'parent' => '',
					'entry'  => $entry['slug'],
					'sort'   => MFM_Docs_Titles::sort_mode( (string) ( $meta['description'] ?? '' ) ),
				];
				$queue = [ $root ];
				while ( $queue ) {
					$parent = array_shift( $queue );
					foreach ( MFM_Docs_Google::children( $parent ) as $item ) {
						if ( self::FOLDER === $item['mimeType'] ) {
							if ( ! isset( $folders[ $item['id'] ] ) ) {
								$folders[ $item['id'] ] = [
									'name'   => $item['name'],
									'parent' => $parent,
									'entry'  => $entry['slug'],
									'sort'   => MFM_Docs_Titles::sort_mode( (string) ( $item['description'] ?? '' ) ),
								];
								$queue[] = $item['id'];
							}
						} elseif ( in_array( $item['mimeType'], self::SUPPORTED, true ) ) {
							$files[ $item['id'] ] = self::file_record( $item, $parent );
						}
					}
				}
			}

			// Cited files that live outside the entry folders.
			foreach ( array_keys( self::cited() ) as $id ) {
				if ( isset( $files[ $id ] ) || isset( $folders[ $id ] ) ) {
					continue;
				}
				try {
					$item = MFM_Docs_Google::meta( $id );
					if ( empty( $item['trashed'] ) && in_array( $item['mimeType'], self::SUPPORTED, true ) ) {
						$files[ $id ] = self::file_record( $item, '' );
					}
				} catch ( RuntimeException $e ) {
					MFM_Docs_Log::error( 'Cited document ' . $id . ': ' . $e->getMessage() );
				}
			}

			update_option( self::TREE_OPTION, [ 'folders' => $folders, 'files' => $files, 'synced' => time() ], false );
			$result['folders'] = count( $folders );
			$result['files']   = count( $files );

			$changed = self::changes( $old['files'], $files );
			if ( $changed ) {
				MFM_Docs_Log::info( sprintf( 'Drive changes: %d document(s) added or updated.', $changed ) );
			}

			// Fill the cache with exactly what the lists link to, until the
			// budget runs out (the rest is built on the next run or on request).
			foreach ( self::wanted() as [ $id, $fmt ] ) {
				if ( time() - $start >= $budget ) {
					break;
				}
				if ( ! MFM_Docs_Cache::has( $id, $fmt ) ) {
					try {
						MFM_Docs_Cache::ensure( $id, $fmt );
						$result['converted']++;
					} catch ( RuntimeException $e ) {
						MFM_Docs_Log::error( $files[ $id ]['name'] . ' (' . $fmt . '): ' . $e->getMessage() );
					}
				}
			}

			MFM_Docs_Cache::prune( $files );
			$result['ok'] = true;
			update_option( 'mfm_docs_last_error', '', false );
		} catch ( RuntimeException $e ) {
			$result['error'] = $e->getMessage();
			MFM_Docs_Log::error( 'Sync failed: ' . $e->getMessage() );
			update_option( 'mfm_docs_last_error', $e->getMessage(), false );
		} finally {
			delete_transient( self::LOCK );
		}
		return $result;
	}

	/**
	 * Every [file id, format] a visitor can reach from a list or a card:
	 * each row's PDF. (Word copies are no longer offered on the lists; the
	 * /docs/file/<id>.docx address still works and is built on request.)
	 *
	 * @return array<int, array{0:string,1:string}>
	 */
	private static function wanted(): array {
		$out = [];
		$add = function ( ?array $row ) use ( &$out ) {
			if ( ! $row ) {
				return;
			}
			$out[ $row['id'] . '.pdf' ] = [ $row['id'], 'pdf' ];
		};
		foreach ( array_keys( self::tree()['folders'] ) as $folder ) {
			foreach ( self::rows( $folder ) as $row ) {
				if ( 'doc' === $row['type'] ) {
					$add( $row );
				}
			}
		}
		foreach ( array_keys( self::cited() ) as $id ) {
			if ( self::file( $id ) && '' === self::file( $id )['parent'] ) {
				$add( self::doc_row_for( $id ) );
			}
		}
		return array_values( $out );
	}

	private static function file_record( array $item, string $parent ): array {
		return [
			'name'     => $item['name'],
			'mime'     => $item['mimeType'],
			'parent'   => $parent,
			'modified' => $item['modifiedTime'] ?? '',
			// md5 for uploaded files; Drive's version counter for native Google files.
			'version'  => $item['md5Checksum'] ?? ( ( $item['version'] ?? '' ) . '-' . ( $item['modifiedTime'] ?? '' ) ),
		];
	}

	private static function changes( array $old, array $new ): int {
		$n = 0;
		foreach ( $new as $id => $f ) {
			if ( ! isset( $old[ $id ] ) || $old[ $id ]['version'] !== $f['version'] ) {
				$n++;
			}
		}
		return $n;
	}

	/* -------------------------------------------------------- citations */

	/** Drive IDs used by [mfm_doc] / [embed-all] in a piece of content. */
	public static function ids_in( string $content ): array {
		if ( ! preg_match_all( '/\[(?:mfm_doc|embed-all)\b[^\]]*?\bid\s*=\s*["\']?([A-Za-z0-9_-]{10,})/i', $content, $m ) ) {
			return [];
		}
		return array_values( array_unique( $m[1] ) );
	}

	public static function on_save_post( int $post_id, WP_Post $post ): void {
		if ( wp_is_post_revision( $post_id ) || 'publish' !== $post->post_status ) {
			return;
		}
		$ids = self::ids_in( (string) $post->post_content );
		if ( ! $ids ) {
			return;
		}
		$cited = self::cited();
		$new   = array_diff( $ids, array_keys( $cited ) );
		if ( ! $new ) {
			return;
		}
		foreach ( $new as $id ) {
			$cited[ $id ] = true;
		}
		update_option( self::CITED_OPTION, $cited, false );
		// Pick the new documents up soon rather than in up to 5 minutes.
		wp_schedule_single_event( time() + 5, self::CRON_HOOK );
	}

	/** Rebuild the cited list from all published content (on activation). */
	public static function rescan_citations(): int {
		global $wpdb;
		$rows = $wpdb->get_col(
			"SELECT post_content FROM {$wpdb->posts}
			  WHERE post_status = 'publish'
			    AND ( post_content LIKE '%[mfm_doc%' OR post_content LIKE '%[embed-all%' )"
		);
		$cited = [];
		foreach ( $rows as $content ) {
			foreach ( self::ids_in( (string) $content ) as $id ) {
				$cited[ $id ] = true;
			}
		}
		update_option( self::CITED_OPTION, $cited, false );
		return count( $cited );
	}
}

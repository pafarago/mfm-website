<?php
/**
 * The document cache: one file per document version and format, named
 * <fileId>-<version hash>.<pdf|docx>, in MFM_DOCS_CACHE_DIR (outside the web
 * root). A new version gets a new name, so a cached copy is never stale;
 * older copies are removed by prune().
 */

defined( 'ABSPATH' ) || exit;

class MFM_Docs_Cache {

	/** Office formats LibreOffice turns into PDF, with the extension it needs. */
	const OFFICE = [
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document'   => 'docx',
		'application/msword'                                                        => 'doc',
		'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'         => 'xlsx',
		'application/vnd.ms-excel'                                                  => 'xls',
		'application/vnd.openxmlformats-officedocument.presentationml.presentation' => 'pptx',
		'application/vnd.ms-powerpoint'                                             => 'ppt',
		'application/rtf'                                                           => 'rtf',
		'application/vnd.oasis.opendocument.text'                                   => 'odt',
	];

	public static function dir(): string {
		return rtrim( MFM_DOCS_CACHE_DIR, '/' );
	}

	public static function writable(): bool {
		return is_dir( self::dir() ) && is_writable( self::dir() );
	}

	public static function path( string $id, string $fmt ): ?string {
		$f = MFM_Docs_Library::file( $id );
		if ( ! $f ) {
			return null;
		}
		return self::dir() . '/' . $id . '-' . self::key( $f ) . '.' . $fmt;
	}

	/** Short, filename-safe hash of the file's version. Also used as the ETag. */
	public static function key( array $f ): string {
		return substr( sha1( $f['version'] . '|' . $f['mime'] ), 0, 16 );
	}

	public static function has( string $id, string $fmt ): bool {
		$p = self::path( $id, $fmt );
		return $p !== null && is_file( $p ) && filesize( $p ) > 0;
	}

	/**
	 * Make sure the cached copy exists; build it if not.
	 *
	 * @throws RuntimeException
	 */
	public static function ensure( string $id, string $fmt ): string {
		$path = self::path( $id, $fmt );
		if ( null === $path ) {
			throw new RuntimeException( 'Unknown document' );
		}
		if ( is_file( $path ) && filesize( $path ) > 0 ) {
			return $path;
		}
		if ( ! self::writable() ) {
			throw new RuntimeException( 'Cache folder ' . self::dir() . ' is missing or not writable' );
		}

		// One build at a time (Drive downloads and LibreOffice): a second
		// request for the same file waits, then finds it done.
		$lock = fopen( self::dir() . '/.build.lock', 'c' );
		flock( $lock, LOCK_EX );
		try {
			clearstatcache( true, $path );
			if ( is_file( $path ) && filesize( $path ) > 0 ) {
				return $path;
			}
			$tmp = $path . '.part';
			self::build( $id, $fmt, $tmp );
			self::check( $tmp, $fmt );
			rename( $tmp, $path );
			self::remove_old( $id, $fmt, basename( $path ) );
			return $path;
		} finally {
			flock( $lock, LOCK_UN );
			fclose( $lock );
			@unlink( $path . '.part' );
		}
	}

	private static function build( string $id, string $fmt, string $dest ): void {
		$f    = MFM_Docs_Library::file( $id );
		$mime = $f['mime'];

		if ( 'pdf' === $fmt && 'application/pdf' === $mime ) {
			MFM_Docs_Google::download( $id, $dest );
			return;
		}
		if ( isset( MFM_Docs_Google::EXPORT[ $mime ][ $fmt ] ) ) {
			MFM_Docs_Google::export( $id, MFM_Docs_Google::EXPORT[ $mime ][ $fmt ], $dest );
			return;
		}
		if ( 'docx' === $fmt && MFM_Docs_Library::DOCX_MIME === $mime ) {
			MFM_Docs_Google::download( $id, $dest );
			return;
		}
		if ( 'pdf' === $fmt && isset( self::OFFICE[ $mime ] ) ) {
			self::convert_office( $id, self::OFFICE[ $mime ], $dest );
			return;
		}
		throw new RuntimeException( "Can't produce $fmt from $mime" );
	}

	/** Download an Office file and convert it to PDF with LibreOffice. */
	private static function convert_office( string $id, string $ext, string $dest ): void {
		$soffice = self::soffice();
		if ( ! $soffice ) {
			throw new RuntimeException( 'LibreOffice (soffice) not found' );
		}
		$work = self::dir() . '/.work-' . wp_generate_password( 10, false );
		wp_mkdir_p( $work );
		$in = $work . '/doc.' . $ext;

		try {
			$cached = 'docx' === $ext ? self::path( $id, 'docx' ) : null;
			if ( $cached && is_file( $cached ) ) {
				copy( $cached, $in );       // the Word chip's copy is already here
			} else {
				MFM_Docs_Google::download( $id, $in );
			}

			// Runs under the build lock, so LibreOffice never runs twice at once
			// (it copes badly with parallel runs sharing a profile).
			$cmd = sprintf(
				'HOME=%s timeout 180 %s -env:UserInstallation=%s --headless --norestore --nolockcheck --convert-to pdf --outdir %s %s 2>&1',
				escapeshellarg( self::dir() . '/.lo-profile' ), // www-data's own home isn't writable
				escapeshellarg( $soffice ),
				escapeshellarg( 'file://' . self::dir() . '/.lo-profile' ),
				escapeshellarg( $work ),
				escapeshellarg( $in )
			);
			exec( $cmd, $out, $code );

			$pdf = $work . '/doc.pdf';
			if ( 0 !== $code || ! is_file( $pdf ) ) {
				throw new RuntimeException( 'LibreOffice conversion failed (code ' . $code . '): ' . substr( implode( ' ', (array) $out ), 0, 200 ) );
			}
			rename( $pdf, $dest );
		} finally {
			foreach ( glob( $work . '/*' ) ?: [] as $f ) {
				@unlink( $f );
			}
			@rmdir( $work );
		}
	}

	public static function soffice(): ?string {
		if ( defined( 'MFM_DOCS_SOFFICE' ) ) {
			return MFM_DOCS_SOFFICE;
		}
		foreach ( [ '/usr/bin/soffice', '/usr/bin/libreoffice', '/usr/local/bin/soffice', '/snap/bin/libreoffice' ] as $p ) {
			if ( is_executable( $p ) ) {
				return $p;
			}
		}
		return null;
	}

	/** Reject error pages or empty files saved under a document's name. */
	private static function check( string $file, string $fmt ): void {
		$head = (string) file_get_contents( $file, false, null, 0, 5 );
		$ok   = 'pdf' === $fmt ? str_starts_with( $head, '%PDF' ) : str_starts_with( $head, "PK\x03\x04" );
		if ( ! $ok ) {
			throw new RuntimeException( "Downloaded file is not a valid $fmt" );
		}
	}

	private static function remove_old( string $id, string $fmt, string $keep ): void {
		foreach ( glob( self::dir() . '/' . $id . '-*.' . $fmt ) ?: [] as $old ) {
			if ( basename( $old ) !== $keep ) {
				@unlink( $old );
			}
		}
	}

	/** Delete cached files for documents that no longer exist or have changed. */
	public static function prune( array $files ): void {
		$wanted = [];
		foreach ( $files as $id => $f ) {
			$wanted[ $id . '-' . self::key( $f ) ] = true;
		}
		foreach ( glob( self::dir() . '/*.{pdf,docx}', GLOB_BRACE ) ?: [] as $path ) {
			$stem = preg_replace( '/\.(pdf|docx)$/', '', basename( $path ) );
			if ( ! isset( $wanted[ $stem ] ) && filemtime( $path ) < time() - HOUR_IN_SECONDS ) {
				@unlink( $path );
			}
		}
		foreach ( glob( self::dir() . '/*.part' ) ?: [] as $path ) {
			if ( filemtime( $path ) < time() - DAY_IN_SECONDS ) {
				@unlink( $path );
			}
		}
	}

	/** Remove every cached document (Settings → MFM Docs → Clear cache). */
	public static function clear(): int {
		$n = 0;
		foreach ( glob( self::dir() . '/*.{pdf,docx}', GLOB_BRACE ) ?: [] as $path ) {
			$n += (int) @unlink( $path );
		}
		return $n;
	}

	public static function stats(): array {
		$files = glob( self::dir() . '/*.{pdf,docx}', GLOB_BRACE ) ?: [];
		return [ 'count' => count( $files ), 'bytes' => array_sum( array_map( 'filesize', $files ) ) ];
	}
}

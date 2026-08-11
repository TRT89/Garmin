import { NextResponse } from 'next/server';
import { FitProvider, type FitUpload } from '@/garmin/providers/FitProvider';
import { syncPipeline } from '@/garmin/syncPipeline';

/** Refuse anything implausibly large before reading it into memory. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 25;

/**
 * Accepts one or more `.FIT` files.
 *
 * Uploads run through the same pipeline as any other sync, so importing a file
 * also recalculates metrics, matches the session to your plan and reviews
 * whether upcoming workouts should change.
 *
 * Files that cannot be parsed are reported individually rather than failing the
 * whole batch — and are never silently replaced with placeholder data.
 */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const entries = form.getAll('files').filter((f): f is File => f instanceof File);

    if (entries.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'No files were uploaded.' },
        { status: 400 },
      );
    }

    if (entries.length > MAX_FILES) {
      return NextResponse.json(
        { ok: false, error: `Please upload at most ${MAX_FILES} files at a time.` },
        { status: 400 },
      );
    }

    const uploads: FitUpload[] = [];
    for (const file of entries) {
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          {
            ok: false,
            error: `${file.name} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB, which is far bigger than any real FIT file.`,
          },
          { status: 400 },
        );
      }
      uploads.push({
        filename: file.name,
        data: new Uint8Array(await file.arrayBuffer()),
      });
    }

    const provider = new FitProvider(uploads);
    const report = await syncPipeline(provider);

    return NextResponse.json({
      ok: report.status === 'success',
      ...report,
      // Per-file problems, so the athlete knows exactly which file failed and why.
      failures: provider.failures,
      filesAccepted: uploads.length - provider.failures.length,
      filesRejected: provider.failures.length,
    });
  } catch (error) {
    console.error('FIT upload failed:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'The upload could not be processed.',
      },
      { status: 500 },
    );
  }
}

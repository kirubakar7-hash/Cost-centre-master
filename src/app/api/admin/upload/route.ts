import { withUser } from '@/lib/db';
import { errorResponse, requireFinanceApi } from '@/lib/session';
import { MAX_UPLOAD_BYTES, UploadParseError } from '@/lib/upload/parse';
import { UploadError, stageUpload } from '@/lib/upload/service';

export async function POST(req: Request) {
  try {
    const user = await requireFinanceApi();
    const form = await req.formData();
    const kind = form.get('kind');
    const file = form.get('file');
    if (kind !== 'master' && kind !== 'owners' && kind !== 'financials' && kind !== 'allocations') return Response.json({ error: 'Invalid upload type' }, { status: 400 });
    if (!(file instanceof File)) return Response.json({ error: 'No file received' }, { status: 400 });
    if (file.size > MAX_UPLOAD_BYTES) return Response.json({ error: 'File larger than 5 MB' }, { status: 413 });
    if (!/\.(xlsx|csv)$/i.test(file.name)) return Response.json({ error: 'Only .xlsx or .csv files are accepted' }, { status: 400 });
    const data = Buffer.from(await file.arrayBuffer());
    const result = await withUser(user.email, (tx) => stageUpload(tx, user.email, kind, file.name, data));
    return Response.json(result);
  } catch (err) {
    if (err instanceof UploadError || err instanceof UploadParseError) return Response.json({ error: err.message }, { status: 400 });
    return errorResponse(err);
  }
}

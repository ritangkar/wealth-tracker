import { useState } from 'preact/hooks';
import { Button, Card, Row, Sheet, TextField, SelectField, useConfirm } from '../../kit';
import { toast, useDb, useStore } from '../../state';

export function CategoriesCard() {
  const db = useDb(); const store = useStore(); const [ask, dialog] = useConfirm();
  const [edit, setEdit] = useState<null | { id?: string; parentId?: string; name: string }>(null); const [err, setErr] = useState('');
  const tops = db.categories.filter((c) => !c.parentId && c.kind === 'expense');
  const save = async () => {
    if (!edit) return; setErr('');
    const r = edit.id ? await store.renameCategory(edit.id, edit.name) : await store.addCategory({ name: edit.name, kind: 'expense', parentId: edit.parentId });
    if (r.ok) { setEdit(null); toast('Saved'); } else setErr(r.issues[0].message);
  };
  const del = async (id: string, name: string) => {
    if (!(await ask({ title: `Delete “${name}”?`, body: <p>This only works if nothing uses it.</p>, danger: true, confirmLabel: 'Delete' }))) return;
    const r = await store.deleteCategory(id); toast(r.ok ? 'Deleted' : r.issues[0].message, r.ok ? 'ok' : 'error');
  };
  return (
    <Card title="Categories" action={<Button size="sm" onClick={() => setEdit({ name: '' })}>＋ Category</Button>}>
      <p class="muted">Keep it simple — a handful of categories with a few subcategories is plenty. Insights use the built-in ones (groceries, food delivery, transport…) so renaming is fine, deleting those may hide an insight.</p>
      {tops.map((c) => (
        <details class="disclosure" key={c.id}><summary>{c.name} <span class="muted">({db.categories.filter((s) => s.parentId === c.id).length})</span></summary>
          <div class="disclosure-body">
            {db.categories.filter((s) => s.parentId === c.id).map((s) => <Row key={s.id} title={s.name} right={<span><Button size="sm" variant="ghost" onClick={() => setEdit({ id: s.id, name: s.name })}>Rename</Button><Button size="sm" variant="ghost" onClick={() => del(s.id, s.name)}>Delete</Button></span>} />)}
            <div class="page-actions"><Button size="sm" onClick={() => setEdit({ parentId: c.id, name: '' })}>＋ Subcategory</Button><Button size="sm" variant="ghost" onClick={() => setEdit({ id: c.id, name: c.name })}>Rename</Button><Button size="sm" variant="ghost" onClick={() => del(c.id, c.name)}>Delete</Button></div>
          </div></details>
      ))}
      {edit && <Sheet title={edit.id ? 'Rename' : edit.parentId ? 'New subcategory' : 'New category'} onClose={() => { setEdit(null); setErr(''); }} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
        {!edit.id && <SelectField label="Under" value={edit.parentId ?? ''} onChange={(v) => setEdit({ ...edit, parentId: v || undefined })} options={[{ value: '', label: 'Top level' }, ...tops.map((t) => ({ value: t.id, label: t.name }))]} />}
        <TextField label="Name" value={edit.name} onInput={(v) => setEdit({ ...edit, name: v })} error={err} autoFocus />
      </Sheet>}
      {dialog}
    </Card>
  );
}

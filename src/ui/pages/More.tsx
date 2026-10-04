import { Card, Page, Row } from '../kit';
import { ROUTES } from '../routes';
export default function More() {
  return (
    <Page title="More">
      <Card>{ROUTES.filter((r) => r.group === 'more').map((r) => <Row key={r.path} href={`#${r.path}`} leading={r.icon} title={r.title} right="›" />)}</Card>
    </Page>
  );
}

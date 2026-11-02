import type { ReactNode } from 'react';
import { Col, Row, Typography } from 'antd';
import './RuntimeConfigPanel.css';

export default function SettingsSection({
  title,
  description,
  badge,
  stacked = false,
  children,
}: {
  title: string;
  description?: ReactNode;
  badge?: ReactNode;
  stacked?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`settings-section${stacked ? ' settings-section--stacked' : ''}`}>
      <Row gutter={[stacked ? 0 : 40, 20]}>
        <Col xs={24} md={stacked ? 24 : 8} lg={stacked ? 24 : 6} className="settings-section__heading">
          <Typography.Text strong style={{ fontSize: 14 }}>
            {title}
            {badge ? <> {badge}</> : null}
          </Typography.Text>
          {description && (
            <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
              {description}
            </Typography.Paragraph>
          )}
        </Col>
        <Col xs={24} md={stacked ? 24 : 16} lg={stacked ? 24 : 18} className="settings-section__content">
          {children}
        </Col>
      </Row>
    </section>
  );
}

import type { ReactNode } from 'react';
import { Col, Row, Typography } from 'antd';
import './RuntimeConfigPanel.css';

export default function SettingsSection({
  title,
  description,
  badge,
  children,
}: {
  title: string;
  description?: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="settings-section">
      <Row gutter={[40, 20]}>
        <Col xs={24} md={8} lg={6} className="settings-section__heading">
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
        <Col xs={24} md={16} lg={18} className="settings-section__content">
          {children}
        </Col>
      </Row>
    </section>
  );
}

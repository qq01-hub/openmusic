import type { ThemeConfig } from 'antd';

export const adminTheme: ThemeConfig = {
  token: {
    colorPrimary: '#2563eb',
    colorInfo: '#2563eb',
    colorSuccess: '#2563eb',
    colorError: '#b83e42',
    colorBgLayout: '#f5f6f8',
    colorBorderSecondary: '#e5e7eb',
    borderRadius: 10,
    fontFamily: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif`,
  },
  components: {
    Layout: {
      siderBg: '#fff',
      headerBg: '#fff',
      bodyBg: '#f5f6f8',
    },
    Menu: {
      itemSelectedBg: '#2563eb',
      itemSelectedColor: '#fff',
      itemHoverBg: '#eff6ff',
    },
    Card: {
      headerFontSize: 15,
    },
    Button: {
      defaultShadow: 'none',
      primaryShadow: 'none',
      dangerShadow: 'none',
    },
    Table: {
      headerBg: '#ffffff',
      cellPaddingBlock: 14,
      cellPaddingInline: 16,
    },
  },
};

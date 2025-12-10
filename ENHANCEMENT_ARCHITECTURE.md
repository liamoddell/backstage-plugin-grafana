# Plugin Enhancement Architecture

## Overview
This document outlines the architecture for enhancing the Grafana Backstage plugin to provide inline visualizations, SLO integration, and improved alert displays to compete with Datadog's Backstage integration.

## Current State
- Frontend-only plugin using Backstage proxy pattern
- Two components: DashboardsCard (links only), AlertsCard (basic list)
- Supports unified alerting and legacy alerts
- No inline visualizations or metrics
- No SLO support

## Goals
1. **Inline Metrics Visualization**: Show RED metrics (Request rate, Error rate, Duration) directly in Backstage
2. **SLO Integration**: Display SLO status, burn rate, and error budget
3. **Enhanced Alerts**: Group by severity, show firing duration, better visual hierarchy
4. **Dashboard Embedding**: Embed dashboard panels inline (stretch goal)

## Architecture Design

### 1. Type System Extensions

#### New Types (`src/types.ts`)

```typescript
// Time series data
export interface MetricDataPoint {
  timestamp: number;
  value: number;
}

export interface TimeSeries {
  target: string;
  datapoints: MetricDataPoint[];
}

// Metrics response from Grafana
export interface MetricsQueryResponse {
  status: string;
  data: {
    resultType: string;
    result: Array<{
      metric: Record<string, string>;
      values: Array<[number, string]>;
    }>;
  };
}

// Dashboard details with panels
export interface DashboardDetail extends Dashboard {
  uid: string;
  panels: DashboardPanel[];
}

export interface DashboardPanel {
  id: number;
  title: string;
  type: string;
  targets: PanelTarget[];
}

export interface PanelTarget {
  expr: string;
  datasource: any;
}

// SLO data
export interface SLO {
  uuid: string;
  name: string;
  description: string;
  query: {
    type: string;
  };
  objectives: Array<{
    value: number;
    window: string;
  }>;
  status?: {
    current: number;
    remaining_error_budget: number;
  };
  labels?: Record<string, string>;
}

// Enhanced alert with metadata
export interface AlertDetail extends Alert {
  severity?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  state: string;
  firing_since?: string;
}

// Time range for queries
export interface TimeRange {
  from: string; // e.g., "now-1h"
  to: string;   // e.g., "now"
}
```

### 2. API Extensions

#### Extended API Interface (`src/api.ts`)

```typescript
export interface GrafanaApi {
  // Existing methods
  listDashboards(query: string): Promise<Dashboard[]>;
  alertsForSelector(selector: string): Promise<Alert[]>;

  // New methods for inline visualizations
  getDashboardByUid(uid: string): Promise<DashboardDetail>;
  queryMetrics(query: string, timeRange: TimeRange): Promise<TimeSeries[]>;
  getSLOs(labelSelector?: string): Promise<SLO[]>;
  getAlertDetails(selector: string): Promise<AlertDetail[]>;
}
```

#### Implementation Strategy

**Grafana API Endpoints to Use:**
- `/api/dashboards/uid/:uid` - Get dashboard configuration
- `/api/datasources/proxy/:datasourceId/api/v1/query_range` - Query Prometheus metrics
- `/api/v1/slo` - Get SLOs (Grafana Cloud SLO app)
- `/api/ruler/grafana/api/v1/rules` - Get detailed alert rules (already used)

**Datasource Discovery:**
- Query `/api/datasources` to find default Prometheus datasource
- Cache datasource ID for subsequent queries

### 3. Component Architecture

#### Component Hierarchy

```
EntityPage
├── MetricsCard (NEW)
│   ├── MetricChart (RED metrics visualization)
│   └── TimeRangeSelector
├── SLOCard (NEW)
│   ├── SLOList
│   └── SLOStatusItem
│       ├── SLOProgressBar (error budget)
│       └── BurnRateIndicator
├── EnhancedAlertsCard (ENHANCED)
│   ├── AlertSeverityGroup (critical/warning/info)
│   └── AlertDetailRow
│       ├── AlertStatusBadge
│       ├── AlertAnnotations
│       └── FiringDuration
└── DashboardsCard (EXISTING)
```

#### 3.1 MetricsCard Component

**Purpose**: Display RED metrics (Request rate, Error rate, Duration p95) inline

**Features**:
- Three time-series charts (recharts line charts)
- Time range selector (1h, 6h, 24h, 7d)
- Auto-refresh every 30s
- Uses span metrics from OTEL collector: `traces_spanmetrics_*`

**Annotations**:
```yaml
grafana/metrics-selector: "service_name=frontend,service_namespace=opentelemetry-demo"
```

**Metrics Queries**:
```promql
# Request Rate
rate(traces_spanmetrics_calls_total{service_name="$service"}[5m])

# Error Rate
rate(traces_spanmetrics_calls_total{service_name="$service",status_code="STATUS_CODE_ERROR"}[5m])
  / rate(traces_spanmetrics_calls_total{service_name="$service"}[5m])

# P95 Latency
histogram_quantile(0.95,
  rate(traces_spanmetrics_latency_bucket{service_name="$service"}[5m])
)
```

#### 3.2 SLOCard Component

**Purpose**: Display SLOs for the service with error budget and burn rate

**Features**:
- List of SLOs matching label selector
- SLO compliance percentage
- Error budget remaining (visual progress bar)
- Burn rate indicator
- Status: healthy (green) / warning (yellow) / breached (red)
- Link to Grafana SLO details

**Annotations**:
```yaml
grafana/slo-label-selector: "service_name=frontend"
```

**API Integration**:
- Use Grafana Cloud SLO API: `/api/plugins/grafana-slo-app/resources/v1/slo`
- Filter by labels matching annotation
- Calculate burn rate from objectives and current status

#### 3.3 EnhancedAlertsCard Component

**Purpose**: Improve current AlertsCard with severity grouping and metadata

**Features**:
- Group alerts by severity (critical, warning, info)
- Collapsible severity groups
- Show alert state with colored badges
- Display firing duration
- Show annotations (summary, description)
- Link to alert rule in Grafana

**Enhanced Selector**:
```yaml
# Support multiple label selectors (comma-separated)
grafana/alert-label-selector: "service_name=frontend,service_namespace=opentelemetry-demo"
```

**API Enhancement**:
- Parse alert labels for `severity` field
- Extract annotations for display
- Calculate firing duration from `startsAt` timestamp

#### 3.4 DashboardPanelCard Component (Stretch Goal)

**Purpose**: Embed specific dashboard panel inline

**Features**:
- Render a single dashboard panel inline
- Support graph/timeseries panel types
- Time range selector
- Link to full dashboard

**Annotations**:
```yaml
grafana/dashboard-embed: "dashboard-uid:panel-id"
```

### 4. Dependencies

**Add to package.json**:
```json
{
  "dependencies": {
    "recharts": "^2.5.0",
    "date-fns": "^2.29.3"
  }
}
```

**Recharts**: Lightweight charting library for React
**date-fns**: Date formatting and manipulation

### 5. Implementation Phases

#### Phase 1: Foundation (API Extensions)
1. Extend `types.ts` with new interfaces
2. Add `queryMetrics()` method to API clients
3. Add `getSLOs()` method to API clients
4. Add `getAlertDetails()` method to API clients
5. Add datasource discovery logic
6. Test API methods with existing Grafana Cloud setup

#### Phase 2: MetricsCard (Highest Priority)
1. Create `MetricsCard` component structure
2. Implement metric query logic (RED metrics)
3. Add recharts line chart components
4. Add time range selector
5. Add auto-refresh logic
6. Export component from index.ts
7. Test with OTEL demo services

#### Phase 3: EnhancedAlertsCard
1. Enhance `getAlertDetails()` to include severity and metadata
2. Create `AlertSeverityGroup` component
3. Create `AlertDetailRow` with annotations
4. Add severity-based grouping logic
5. Add collapsible groups
6. Replace existing AlertsCard in exports

#### Phase 4: SLOCard
1. Implement `getSLOs()` API method
2. Create `SLOCard` component
3. Create `SLOProgressBar` for error budget
4. Create `BurnRateIndicator` component
5. Add status calculation logic
6. Export component from index.ts
7. Test with Grafana Cloud SLOs

#### Phase 5: DashboardPanelCard (Optional)
1. Implement `getDashboardByUid()` API method
2. Create `DashboardPanelCard` component
3. Create `PanelRenderer` for different panel types
4. Add query execution logic
5. Render with recharts

### 6. Entity Page Integration

**Updated EntityPage.tsx**:
```tsx
import {
  EntityGrafanaDashboardsCard,
  EntityGrafanaAlertsCard,
  EntityGrafanaMetricsCard,      // NEW
  EntityGrafanaSLOCard,           // NEW
  EntityGrafanaEnhancedAlertsCard // NEW (replaces AlertsCard)
} from '@k-phoen/backstage-plugin-grafana';

// Updated Grafana tab layout
<EntityLayout.Route path="/grafana" title="Grafana">
  <Grid container spacing={3}>
    {/* Row 1: Metrics Overview */}
    <Grid item xs={12}>
      <EntityGrafanaMetricsCard />
    </Grid>

    {/* Row 2: SLOs and Enhanced Alerts */}
    <Grid item md={6}>
      <EntityGrafanaSLOCard />
    </Grid>
    <Grid item md={6}>
      <EntityGrafanaEnhancedAlertsCard />
    </Grid>

    {/* Row 3: Dashboard Links */}
    <Grid item xs={12}>
      <EntityGrafanaDashboardsCard />
    </Grid>
  </Grid>
</EntityLayout.Route>
```

### 7. Configuration

**app-config.yaml additions**:
```yaml
grafana:
  domain: 'https://liamoddellmlt.grafana.net'
  unifiedAlerting: true
  # New: Default datasource UID for metric queries
  defaultPrometheusUid: 'prometheus-uid'  # Optional, will auto-discover if not set
  # New: Enable SLO support (requires Grafana Cloud or SLO plugin)
  sloSupport: true
```

### 8. Testing Strategy

#### Unit Tests
- API methods with mocked fetch responses
- Component rendering with mock data
- Query parsing and evaluation

#### Integration Tests
- Test with running OTEL demo
- Verify metrics queries return data
- Verify SLO API integration
- Verify alert details parsing

#### Manual Testing
1. Start OTEL demo with load generator
2. Create dashboards/SLOs/alerts in Grafana Cloud (per GRAFANA_CLOUD_SETUP.md)
3. Load Backstage and navigate to service entity
4. Verify MetricsCard shows RED metrics
5. Verify SLOCard shows SLO status
6. Verify EnhancedAlertsCard groups alerts by severity

### 9. Success Criteria

**Competitive with Datadog Plugin:**
- ✅ Inline metrics visualization (RED metrics)
- ✅ SLO tracking (Grafana's strength)
- ✅ Enhanced alert displays
- ✅ Service health at a glance
- ✅ Zero external dependencies (uses Grafana Cloud)
- ✅ Better performance (cached in Backstage)

**User Experience:**
- Load time < 2s for metrics card
- Auto-refresh without UI jank
- Clear visual hierarchy
- Actionable links to Grafana
- No configuration required (annotations only)

## Next Steps

1. Complete architecture review
2. Begin Phase 1: API extensions
3. Implement MetricsCard (highest priority)
4. Test with OTEL demo data
5. Iterate based on user feedback

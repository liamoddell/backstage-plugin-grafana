# Grafana Cloud Setup for Backstage Demo

## Overview
Create dashboards, SLOs, and alerts in Grafana Cloud that will be discovered by the Backstage plugin.

## Service Mapping

| Service | service_name | Dashboard Tag | Alert Labels |
|---------|--------------|---------------|--------------|
| Frontend | `frontend` | `frontend` | `service_name=frontend,service_namespace=opentelemetry-demo` |
| Checkout | `checkoutservice` | `checkoutservice` | `service_name=checkoutservice,service_namespace=opentelemetry-demo` |
| Payment | `paymentservice` | `paymentservice` | `service_name=paymentservice,service_namespace=opentelemetry-demo` |
| Cart | `cartservice` | `cartservice` | `service_name=cartservice,service_namespace=opentelemetry-demo` |
| Product Catalog | `productcatalogservice` | `productcatalogservice` | `service_name=productcatalogservice,service_namespace=opentelemetry-demo` |
| Recommendation | `recommendationservice` | `recommendationservice` | `service_name=recommendationservice,service_namespace=opentelemetry-demo` |
| Shipping | `shippingservice` | `shippingservice` | `service_name=shippingservice,service_namespace=opentelemetry-demo` |
| Email | `emailservice` | `emailservice` | `service_name=emailservice,service_namespace=opentelemetry-demo` |
| Ad Service | `adservice` | `adservice` | `service_name=adservice,service_namespace=opentelemetry-demo` |
| Currency | `currencyservice` | `currencyservice` | `service_name=currencyservice,service_namespace=opentelemetry-demo` |

---

## Step 1: Create Dashboards

### Quick Method: Use App O11y
1. Go to **Application Observability** in Grafana Cloud
2. Navigate to **Services**
3. Click on any service (e.g., `frontend`, `checkoutservice`)
4. Click "View dashboard" or "Create dashboard"
5. **Add tag** to dashboard: Tag must match the service name (e.g., `frontend`, `checkoutservice`)
6. Save the dashboard

### Manual Method: Create Custom Dashboard
For each key service, create a dashboard with these panels:

**Dashboard Settings:**
- Name: `[Service Name] Service Dashboard` (e.g., "Frontend Service Dashboard")
- Tags: Add the service name tag (e.g., `frontend`)

**Key Panels:**
1. **Request Rate** - Query: `rate(traces_spanmetrics_calls_total{service_name="frontend"}[5m])`
2. **Error Rate** - Query: `rate(traces_spanmetrics_calls_total{service_name="frontend",status_code="STATUS_CODE_ERROR"}[5m])`
3. **Latency (p95)** - Query: `histogram_quantile(0.95, traces_spanmetrics_latency_bucket{service_name="frontend"})`
4. **Active Spans** - Query: `traces_spanmetrics_calls_total{service_name="frontend"}`

**Priority Services for Demo:**
- ✅ `frontend` (public-facing)
- ✅ `checkoutservice` (critical path)
- ✅ `paymentservice` (critical, financial)
- ✅ `cartservice` (user experience)

---

## Step 2: Create SLOs

Go to **SLOs** (Grafana Cloud SLO app)

### SLO 1: Frontend Availability
```
Name: Frontend - Service Availability
Description: Percentage of successful requests
Target: 99.9%
Window: 30 days

Success Metric:
  traces_spanmetrics_calls_total{
    service_name="frontend",
    status_code!="STATUS_CODE_ERROR",
    service_namespace="opentelemetry-demo"
  }

Total Metric:
  traces_spanmetrics_calls_total{
    service_name="frontend",
    service_namespace="opentelemetry-demo"
  }

Labels:
  service_name: frontend
  service_namespace: opentelemetry-demo
  slo_type: availability
```

### SLO 2: Payment Success Rate
```
Name: Payment Service - Transaction Success
Description: Percentage of successful payment transactions
Target: 99.5%
Window: 30 days

Success Metric:
  traces_spanmetrics_calls_total{
    service_name="paymentservice",
    status_code!="STATUS_CODE_ERROR",
    service_namespace="opentelemetry-demo"
  }

Total Metric:
  traces_spanmetrics_calls_total{
    service_name="paymentservice",
    service_namespace="opentelemetry-demo"
  }

Labels:
  service_name: paymentservice
  service_namespace: opentelemetry-demo
  slo_type: reliability
  severity: critical
```

### SLO 3: Checkout Latency
```
Name: Checkout Service - Response Time
Description: 95% of requests complete in < 500ms
Target: 95%
Window: 7 days

Good Events: (requests < 500ms)
  histogram_quantile(0.95,
    traces_spanmetrics_latency_bucket{
      service_name="checkoutservice",
      service_namespace="opentelemetry-demo"
    }
  ) < 0.5

Labels:
  service_name: checkoutservice
  service_namespace: opentelemetry-demo
  slo_type: latency
```

**After creating SLOs**, note their UIDs from the URL (e.g., `/a/grafana-slo-app/slos/abc123`)

---

## Step 3: Create Alert Rules

Go to **Alerting** → **Alert rules** → **New alert rule**

### Alert 1: High Error Rate - Frontend
```
Alert name: High Error Rate - Frontend
Folder: Production Alerts / opentelemetry-demo
Evaluation interval: 1m

Query A:
  rate(traces_spanmetrics_calls_total{
    service_name="frontend",
    status_code="STATUS_CODE_ERROR",
    service_namespace="opentelemetry-demo"
  }[5m])

Query B:
  rate(traces_spanmetrics_calls_total{
    service_name="frontend",
    service_namespace="opentelemetry-demo"
  }[5m])

Condition: (A / B) > 0.05  (5% error rate)

Labels:
  service_name: frontend
  service_namespace: opentelemetry-demo
  severity: critical
  team: platform

Annotations:
  summary: Frontend error rate is {{ $values.A.Value | humanizePercentage }}
  description: Error rate has exceeded 5% threshold
```

### Alert 2: High Latency - Checkout
```
Alert name: High Latency - Checkout Service
Folder: Production Alerts / opentelemetry-demo

Query:
  histogram_quantile(0.95,
    rate(traces_spanmetrics_latency_bucket{
      service_name="checkoutservice",
      service_namespace="opentelemetry-demo"
    }[5m])
  )

Condition: > 1.0  (p95 > 1 second)

Labels:
  service_name: checkoutservice
  service_namespace: opentelemetry-demo
  severity: warning
  team: checkout-team

Annotations:
  summary: Checkout p95 latency: {{ $values.A.Value }}s
```

### Alert 3: High Error Rate - Payment
```
Alert name: Payment Service Errors
Folder: Production Alerts / opentelemetry-demo

Query A:
  rate(traces_spanmetrics_calls_total{
    service_name="paymentservice",
    status_code="STATUS_CODE_ERROR",
    service_namespace="opentelemetry-demo"
  }[5m])

Query B:
  rate(traces_spanmetrics_calls_total{
    service_name="paymentservice",
    service_namespace="opentelemetry-demo"
  }[5m])

Condition: (A / B) > 0.01  (1% error rate - stricter for payments)

Labels:
  service_name: paymentservice
  service_namespace: opentelemetry-demo
  severity: critical
  team: checkout-team
  financial: true

Annotations:
  summary: Payment error rate: {{ $values.A.Value | humanizePercentage }}
```

### Alert 4: Cart Service Down
```
Alert name: Cart Service - No Traffic
Folder: Production Alerts / opentelemetry-demo

Query:
  sum(rate(traces_spanmetrics_calls_total{
    service_name="cartservice",
    service_namespace="opentelemetry-demo"
  }[5m]))

Condition: < 0.1  (Less than 0.1 requests/sec)

Labels:
  service_name: cartservice
  service_namespace: opentelemetry-demo
  severity: critical
  team: platform

Annotations:
  summary: Cart service appears to be down (no traffic)
```

---

## Step 4: Verify Setup

### Check Dashboards
```bash
# In Grafana Cloud, go to:
Dashboards → Browse

# Verify each has correct tag:
- Frontend dashboard → tag: "frontend"
- Checkout dashboard → tag: "checkoutservice"
- Payment dashboard → tag: "paymentservice"
```

### Check SLOs
```bash
# Go to: SLOs app
# Verify you see 3 SLOs with proper labels
```

### Check Alerts
```bash
# Go to: Alerting → Alert rules
# Verify you see 4+ alert rules with:
- service_name label
- service_namespace label
```

---

## Step 5: Test in Backstage

Once created, the Backstage plugin will discover them:

1. Go to Backstage: http://localhost:3000
2. Navigate to any service component (e.g., "Checkout Service")
3. Click the "Grafana" tab
4. You should see:
   - **Dashboards card**: Lists matching dashboards
   - **Alerts card**: Shows alerts with matching labels

---

## Minimum Viable Setup

For a quick demo, focus on these 3 services:
1. **Frontend** - 1 dashboard, 1 alert
2. **Checkout** - 1 dashboard, 1 alert, 1 SLO
3. **Payment** - 1 dashboard, 1 alert, 1 SLO

This gives you enough to showcase:
- ✅ Dashboard discovery
- ✅ Alert monitoring
- ✅ SLO tracking
- ✅ Multiple service types

---

## Next: Plugin Enhancements

After creating these assets, we'll enhance the Backstage plugin to show:
- **Inline dashboard panels** (embedded visualizations)
- **SLO status cards** (burn rate, error budget)
- **Alert severity indicators** (critical, warning, ok)
- **Service health summary** (RED metrics at a glance)

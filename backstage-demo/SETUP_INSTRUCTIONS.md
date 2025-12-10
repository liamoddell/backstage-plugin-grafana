# Grafana Plugin Demo Setup Instructions

## What You Need from Grafana Cloud

Before starting Backstage, prepare these items in your Grafana Cloud instance:

### 1. Create an API Token
1. Log into your Grafana Cloud instance (`https://yourorg.grafana.net`)
2. Go to **Administration** → **Service accounts** (or **Configuration** → **API Keys**)
3. Click "Create service account" or "New API key"
4. Name it: `backstage-viewer`
5. Set role: **Viewer** (read-only access)
6. Click "Add service account token" / "Create"
7. **Copy the token** (starts with `glsa_...`) - you won't see it again!

### 2. Prepare Test Dashboards
Tag some of your existing dashboards with tags that match the annotations in `examples/entities.yaml`:
- Tag dashboards with `kubernetes` (for example-website component)
- Tag dashboards with `api` (for demo-api-service component)
- Or update the annotations in `examples/entities.yaml` to match your dashboard tags

To tag a dashboard:
1. Open the dashboard
2. Click the gear icon (Settings)
3. Add tags in the "General" section
4. Save

### 3. Prepare Test Alerts (Optional)
If you want to test the alerts card, create some alert rules with labels:
- `service=example-website`
- `service=demo-api`

## Configure the Demo App

1. **Edit `grafana-demo/app-config.local.yaml`:**
   ```yaml
   proxy:
     '/grafana/api':
       target: 'https://yourorg.grafana.net/'  # Replace with your Grafana Cloud URL
       headers:
         Authorization: 'Bearer glsa_YOUR_TOKEN_HERE'  # Replace with your API token

   grafana:
     domain: 'https://yourorg.grafana.net'  # Replace with your Grafana Cloud URL
   ```

2. **Verify Configuration Files:**
   - `app-config.yaml` contains the base Grafana config (placeholder values)
   - `app-config.local.yaml` overrides with your actual credentials (gitignored)

## Start Backstage

```bash
cd grafana-demo
yarn dev
```

Wait for the app to compile and start (may take 2-3 minutes on first run).

Backstage will be available at: http://localhost:3000

## View the Plugin in Action

1. Open http://localhost:3000
2. Click **Catalog** in the left sidebar
3. Select a component:
   - `example-website` or
   - `demo-api-service`
4. Click the **Grafana** tab in the component page

You should see:
- **Left card:** List of Grafana dashboards (if you tagged them correctly)
- **Right card:** Grafana alerts (if you created alerts with the right labels)

## Troubleshooting

### "No dashboards found"
- Verify your Grafana dashboards have the tags specified in the annotations
- Check that the API token has Viewer permissions
- Check browser console for API errors

### "Failed to fetch dashboards"
- Verify `app-config.local.yaml` has the correct Grafana Cloud URL
- Verify the API token is valid (try it in Grafana's API explorer)
- Check that the proxy configuration is correct

### Proxy/CORS errors
- Make sure both `target` and `domain` use the same Grafana Cloud URL
- Ensure the URL includes `https://` and ends with `/` for the target

### Check Backend Logs
The backend terminal will show Grafana API requests. Look for:
```
[proxy] GET /grafana/api/api/search?type=dash-db&tag=kubernetes 200
```

## Customizing the Annotations

Edit `examples/entities.yaml` to change which dashboards/alerts are shown:

```yaml
annotations:
  # Simple tag selector
  grafana/dashboard-selector: "production"

  # Complex query selector
  grafana/dashboard-selector: "(tags @> 'production' && tags @> 'api') || title == 'My Dashboard'"

  # Alert label selector (unified alerting)
  grafana/alert-label-selector: "severity=critical"
```

## Next Steps

Once you validate the basic functionality:
1. Test with your actual Grafana Cloud dashboards
2. Create more components with different selectors
3. Test the alert integration
4. Try the dashboard embedding feature (requires `allow_embedding=true` in Grafana config)

## Understanding the Plugin Architecture

- **Frontend plugin**: Runs in the browser
- **API calls**: Go through Backstage proxy at `/grafana/api`
- **Authentication**: Backend adds API token to requests
- **No backend plugin**: All logic runs in the frontend

Current plugin version: 0.1.22 (March 2023)
Backstage version: Latest (~1.32+)

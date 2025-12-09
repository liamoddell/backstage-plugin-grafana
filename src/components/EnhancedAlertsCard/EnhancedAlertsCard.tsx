/*
 * Copyright 2021 Kévin Gomez <contact@kevingomez.fr>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import React, { useState } from 'react';
import { Progress, MissingAnnotationEmptyState, Link } from '@backstage/core-components';
import { Entity } from '@backstage/catalog-model';
import { useEntity } from '@backstage/plugin-catalog-react';
import { useApi } from '@backstage/core-plugin-api';
import { grafanaApiRef } from '../../api';
import { useAsync } from 'react-use';
import { Alert } from '@material-ui/lab';
import { AlertDetail } from '../../types';
import {
  GRAFANA_ANNOTATION_ALERT_LABEL_SELECTOR,
  isAlertSelectorAvailable,
  alertSelectorFromEntity
} from '../grafanaData';
import {
  Box,
  Card,
  CardContent,
  Chip,
  Collapse,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  makeStyles,
  Typography,
} from '@material-ui/core';
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';
import ExpandLessIcon from '@material-ui/icons/ExpandLess';
import ErrorIcon from '@material-ui/icons/Error';
import WarningIcon from '@material-ui/icons/Warning';
import InfoIcon from '@material-ui/icons/Info';
import { formatDistanceToNow, parseISO } from 'date-fns';

const useStyles = makeStyles((theme) => ({
  card: {
    height: '100%',
  },
  severityGroup: {
    marginBottom: theme.spacing(2),
  },
  severityHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing(1, 2),
    backgroundColor: theme.palette.background.default,
    borderRadius: theme.shape.borderRadius,
    cursor: 'pointer',
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
    },
  },
  severityTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  },
  criticalIcon: {
    color: theme.palette.error.main,
  },
  warningIcon: {
    color: theme.palette.warning.main,
  },
  infoIcon: {
    color: theme.palette.info.main,
  },
  unknownIcon: {
    color: theme.palette.text.secondary,
  },
  alertItem: {
    paddingLeft: theme.spacing(4),
  },
  alertName: {
    fontWeight: 500,
  },
  stateChip: {
    marginLeft: theme.spacing(1),
  },
  metadata: {
    marginTop: theme.spacing(1),
    fontSize: '0.875rem',
    color: theme.palette.text.secondary,
  },
  annotations: {
    marginTop: theme.spacing(0.5),
  },
  emptyState: {
    padding: theme.spacing(2),
    textAlign: 'center',
    color: theme.palette.text.secondary,
  },
}));

type SeverityLevel = 'critical' | 'warning' | 'info' | 'unknown';

interface GroupedAlerts {
  critical: AlertDetail[];
  warning: AlertDetail[];
  info: AlertDetail[];
  unknown: AlertDetail[];
}

const getSeverityLevel = (alert: AlertDetail): SeverityLevel => {
  const severity = alert.severity?.toLowerCase();
  if (severity === 'critical' || severity === 'high') return 'critical';
  if (severity === 'warning' || severity === 'medium') return 'warning';
  if (severity === 'info' || severity === 'low') return 'info';
  return 'unknown';
};

const getSeverityIcon = (severity: SeverityLevel, classes: any) => {
  switch (severity) {
    case 'critical':
      return <ErrorIcon className={classes.criticalIcon} />;
    case 'warning':
      return <WarningIcon className={classes.warningIcon} />;
    case 'info':
      return <InfoIcon className={classes.infoIcon} />;
    default:
      return <InfoIcon className={classes.unknownIcon} />;
  }
};

const getSeverityColor = (severity: SeverityLevel): 'error' | 'warning' | 'info' | 'default' => {
  switch (severity) {
    case 'critical':
      return 'error';
    case 'warning':
      return 'warning';
    case 'info':
      return 'info';
    default:
      return 'default';
  }
};

const AlertDetailRow = ({ alert, classes }: { alert: AlertDetail; classes: any }) => {
  const firingDuration = alert.firing_since
    ? formatDistanceToNow(parseISO(alert.firing_since), { addSuffix: true })
    : null;

  const summary = alert.annotations?.summary || alert.annotations?.description;

  return (
    <ListItem className={classes.alertItem}>
      <ListItemText
        primary={
          <Box display="flex" alignItems="center">
            <Link to={alert.url} target="_blank" rel="noopener" className={classes.alertName}>
              {alert.name}
            </Link>
            {alert.state !== 'n/a' && (
              <Chip
                label={alert.state}
                size="small"
                color={alert.state === 'firing' ? 'secondary' : 'default'}
                className={classes.stateChip}
              />
            )}
          </Box>
        }
        secondary={
          <Box>
            {summary && (
              <Typography variant="body2" className={classes.metadata}>
                {summary}
              </Typography>
            )}
            {firingDuration && (
              <Typography variant="caption" className={classes.metadata}>
                Firing {firingDuration}
              </Typography>
            )}
            {alert.labels && Object.keys(alert.labels).length > 0 && (
              <Box className={classes.annotations}>
                {Object.entries(alert.labels)
                  .filter(([key]) => key !== 'severity')
                  .slice(0, 3)
                  .map(([key, value]) => (
                    <Chip
                      key={key}
                      label={`${key}: ${value}`}
                      size="small"
                      variant="outlined"
                      style={{ marginRight: 4, marginTop: 4 }}
                    />
                  ))}
              </Box>
            )}
          </Box>
        }
      />
    </ListItem>
  );
};

interface SeverityGroupProps {
  severity: SeverityLevel;
  alerts: AlertDetail[];
  classes: any;
}

const SeverityGroup = ({ severity, alerts, classes }: SeverityGroupProps) => {
  const [expanded, setExpanded] = useState(true);

  if (alerts.length === 0) {
    return null;
  }

  const severityLabels = {
    critical: 'Critical',
    warning: 'Warning',
    info: 'Info',
    unknown: 'Other',
  };

  return (
    <Box className={classes.severityGroup}>
      <Box className={classes.severityHeader} onClick={() => setExpanded(!expanded)}>
        <Box className={classes.severityTitle}>
          {getSeverityIcon(severity, classes)}
          <Typography variant="subtitle1">
            {severityLabels[severity]} ({alerts.length})
          </Typography>
        </Box>
        <IconButton size="small">
          {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        </IconButton>
      </Box>
      <Collapse in={expanded}>
        <List dense>
          {alerts.map((alert, index) => (
            <React.Fragment key={`${alert.name}-${index}`}>
              <AlertDetailRow alert={alert} classes={classes} />
              {index < alerts.length - 1 && <Divider variant="inset" component="li" />}
            </React.Fragment>
          ))}
        </List>
      </Collapse>
    </Box>
  );
};

const groupAlertsBySeverity = (alerts: AlertDetail[]): GroupedAlerts => {
  return alerts.reduce(
    (groups, alert) => {
      const severity = getSeverityLevel(alert);
      groups[severity].push(alert);
      return groups;
    },
    { critical: [], warning: [], info: [], unknown: [] } as GroupedAlerts
  );
};

const EnhancedAlerts = ({ entity, opts }: { entity: Entity; opts: EnhancedAlertsCardOpts }) => {
  const classes = useStyles();
  const grafanaApi = useApi(grafanaApiRef);
  const alertSelector = alertSelectorFromEntity(entity);

  const { value, loading, error } = useAsync(
    async () => await grafanaApi.getAlertDetails(alertSelector)
  );

  if (loading) {
    return <Progress />;
  }

  if (error) {
    return <Alert severity="error">{error.message}</Alert>;
  }

  const alerts = value || [];

  if (alerts.length === 0) {
    return (
      <Box className={classes.emptyState}>
        <Typography variant="body2">No alerts found</Typography>
      </Box>
    );
  }

  const groupedAlerts = groupAlertsBySeverity(alerts);

  return (
    <Box>
      <SeverityGroup severity="critical" alerts={groupedAlerts.critical} classes={classes} />
      <SeverityGroup severity="warning" alerts={groupedAlerts.warning} classes={classes} />
      <SeverityGroup severity="info" alerts={groupedAlerts.info} classes={classes} />
      <SeverityGroup severity="unknown" alerts={groupedAlerts.unknown} classes={classes} />
    </Box>
  );
};

export type EnhancedAlertsCardOpts = {
  title?: string;
};

export const EnhancedAlertsCard = (opts?: EnhancedAlertsCardOpts) => {
  const classes = useStyles();
  const { entity } = useEntity();

  if (!isAlertSelectorAvailable(entity)) {
    return <MissingAnnotationEmptyState annotation={GRAFANA_ANNOTATION_ALERT_LABEL_SELECTOR} />;
  }

  return (
    <Card className={classes.card}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          {opts?.title || 'Alerts'}
        </Typography>
        <EnhancedAlerts entity={entity} opts={opts || {}} />
      </CardContent>
    </Card>
  );
};

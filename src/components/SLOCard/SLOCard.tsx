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

import React from 'react';
import { Progress, Link, MissingAnnotationEmptyState } from '@backstage/core-components';
import { Entity } from '@backstage/catalog-model';
import { useEntity } from '@backstage/plugin-catalog-react';
import { configApiRef, useApi } from '@backstage/core-plugin-api';
import { grafanaApiRef } from '../../api';
import { useAsync } from 'react-use';
import { Alert } from '@material-ui/lab';
import { SLO } from '../../types';
import {
  GRAFANA_ANNOTATION_SLO_LABEL_SELECTOR,
  isSLOSelectorAvailable,
  sloSelectorFromEntity,
} from '../grafanaData';
import {
  Box,
  Card,
  CardContent,
  Chip,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  makeStyles,
  Typography,
} from '@material-ui/core';
import CheckCircleIcon from '@material-ui/icons/CheckCircle';
import WarningIcon from '@material-ui/icons/Warning';
import ErrorIcon from '@material-ui/icons/Error';

const useStyles = makeStyles((theme) => ({
  card: {
    height: '100%',
  },
  sloItem: {
    marginBottom: theme.spacing(2),
    padding: theme.spacing(2),
    backgroundColor: theme.palette.background.default,
    borderRadius: theme.shape.borderRadius,
  },
  sloHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing(1),
  },
  sloName: {
    fontWeight: 500,
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  },
  statusIcon: {
    fontSize: '1.2rem',
  },
  healthyIcon: {
    color: theme.palette.success.main,
  },
  warningIcon: {
    color: theme.palette.warning.main,
  },
  errorIcon: {
    color: theme.palette.error.main,
  },
  objectiveRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing(1),
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
    marginBottom: theme.spacing(1),
  },
  errorBudgetText: {
    fontSize: '0.875rem',
    color: theme.palette.text.secondary,
  },
  description: {
    fontSize: '0.875rem',
    color: theme.palette.text.secondary,
    marginTop: theme.spacing(0.5),
  },
  emptyState: {
    padding: theme.spacing(2),
    textAlign: 'center',
    color: theme.palette.text.secondary,
  },
  labels: {
    marginTop: theme.spacing(1),
  },
}));

interface SLOStatusIndicatorProps {
  slo: SLO;
  classes: any;
}

const SLOStatusIndicator = ({ slo, classes }: SLOStatusIndicatorProps) => {
  const current = slo.status?.current || 0;
  const remainingBudget = slo.status?.remaining_error_budget || 100;

  // Determine health status
  let status: 'healthy' | 'warning' | 'breached';
  let statusIcon: React.ReactNode;
  let statusColor: 'success' | 'warning' | 'error';

  if (remainingBudget > 50) {
    status = 'healthy';
    statusIcon = <CheckCircleIcon className={`${classes.statusIcon} ${classes.healthyIcon}`} />;
    statusColor = 'success';
  } else if (remainingBudget > 0) {
    status = 'warning';
    statusIcon = <WarningIcon className={`${classes.statusIcon} ${classes.warningIcon}`} />;
    statusColor = 'warning';
  } else {
    status = 'breached';
    statusIcon = <ErrorIcon className={`${classes.statusIcon} ${classes.errorIcon}`} />;
    statusColor = 'error';
  }

  const objective = slo.objectives[0];
  const targetPercentage = objective ? objective.value * 100 : 0;
  const currentPercentage = current * 100;

  // Calculate progress bar color
  const getProgressColor = () => {
    if (status === 'healthy') return 'primary';
    if (status === 'warning') return 'secondary';
    return 'secondary';
  };

  return (
    <Box className={classes.sloItem}>
      <Box className={classes.sloHeader}>
        <Typography variant="subtitle1" className={classes.sloName}>
          {statusIcon}
          {slo.name}
        </Typography>
        <Chip
          label={status.toUpperCase()}
          size="small"
          color={statusColor}
        />
      </Box>

      {slo.description && (
        <Typography className={classes.description}>
          {slo.description}
        </Typography>
      )}

      <Box className={classes.objectiveRow}>
        <Typography variant="body2">
          Target: {targetPercentage.toFixed(2)}%
        </Typography>
        <Typography variant="body2" style={{ fontWeight: 500 }}>
          Current: {currentPercentage.toFixed(2)}%
        </Typography>
      </Box>

      <LinearProgress
        variant="determinate"
        value={Math.min(currentPercentage, 100)}
        color={getProgressColor()}
        className={classes.progressBar}
      />

      <Box className={classes.objectiveRow}>
        <Typography className={classes.errorBudgetText}>
          Error Budget Remaining
        </Typography>
        <Typography
          className={classes.errorBudgetText}
          style={{
            fontWeight: 500,
            color: remainingBudget > 50 ? 'inherit' : remainingBudget > 0 ? '#ff9800' : '#f44336',
          }}
        >
          {remainingBudget.toFixed(1)}%
        </Typography>
      </Box>

      {objective && (
        <Typography variant="caption" className={classes.errorBudgetText}>
          Window: {objective.window}
        </Typography>
      )}

      {slo.labels && Object.keys(slo.labels).length > 0 && (
        <Box className={classes.labels}>
          {Object.entries(slo.labels).slice(0, 3).map(([key, value]) => (
            <Chip
              key={key}
              label={`${key}: ${value}`}
              size="small"
              variant="outlined"
              style={{ marginRight: 4 }}
            />
          ))}
        </Box>
      )}
    </Box>
  );
};

const SLOList = ({ entity, opts }: { entity: Entity; opts: SLOCardOpts }) => {
  const classes = useStyles();
  const grafanaApi = useApi(grafanaApiRef);
  const configApi = useApi(configApiRef);
  const domain = configApi.getString('grafana.domain');
  const labelSelector = sloSelectorFromEntity(entity);

  const { value, loading, error } = useAsync(
    async () => await grafanaApi.getSLOs(labelSelector)
  );

  if (loading) {
    return <Progress />;
  }

  if (error) {
    return <Alert severity="error">{error.message}</Alert>;
  }

  const slos = value || [];

  if (slos.length === 0) {
    return (
      <Box className={classes.emptyState}>
        <Typography variant="body2">
          No SLOs found. Make sure you have SLOs configured in Grafana Cloud with matching labels.
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      {slos.map((slo) => (
        <Link
          key={slo.uuid}
          to={`${domain}/a/grafana-slo-app/slo/${slo.uuid}`}
          target="_blank"
          rel="noopener"
          style={{ textDecoration: 'none', color: 'inherit' }}
        >
          <SLOStatusIndicator slo={slo} classes={classes} />
        </Link>
      ))}
    </Box>
  );
};

export type SLOCardOpts = {
  title?: string;
};

export const SLOCard = (opts?: SLOCardOpts) => {
  const classes = useStyles();
  const { entity } = useEntity();

  if (!isSLOSelectorAvailable(entity)) {
    return <MissingAnnotationEmptyState annotation={GRAFANA_ANNOTATION_SLO_LABEL_SELECTOR} />;
  }

  return (
    <Card className={classes.card}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          {opts?.title || 'SLOs'}
        </Typography>
        <SLOList entity={entity} opts={opts || {}} />
      </CardContent>
    </Card>
  );
};

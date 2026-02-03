# Agent-Driven Config Management System

## Overview

The config management system allows OrcBot agents to intelligently manage configuration settings based on task requirements. The system provides a secure, policy-based approach that categorizes configuration options into three levels:

1. **SAFE** - Agent can modify autonomously
2. **APPROVAL** - Agent can request changes, but requires approval
3. **LOCKED** - Agent cannot modify (security-critical settings)

## Architecture

### Components

1. **ConfigPolicy** (`src/config/ConfigPolicy.ts`)
   - Defines policies for all configuration options
   - Validates configuration values
   - Categorizes configs by security level

2. **ConfigManagementService** (`src/skills/configManagement.ts`)
   - Handles configuration read/write operations
   - Manages approval workflow
   - Tracks change history
   - Provides optimization suggestions

3. **manage_config Skill** (registered in `src/core/Agent.ts`)
   - Agent-facing interface for config management
   - Exposes actions: get, set, list, policy, history, pending, approve, reject, suggest

## Usage

### For Agents

Agents can use the `manage_config` skill with various actions:

```javascript
// View current configuration
manage_config({ action: "get", key: "modelName" })

// Modify a safe configuration
manage_config({ 
  action: "set", 
  key: "modelName", 
  value: "gpt-4", 
  reason: "Code task benefits from GPT-4" 
})

// View all configurations categorized by policy
manage_config({ action: "list" })

// View policy descriptions
manage_config({ action: "policy" })

// Request approval for sensitive config
manage_config({ 
  action: "set", 
  key: "openaiApiKey", 
  value: "sk-new-key", 
  reason: "Updating API key" 
})

// View pending approvals
manage_config({ action: "pending" })

// View change history
manage_config({ action: "history", limit: 10 })

// Get optimization suggestions based on task
manage_config({ 
  action: "suggest", 
  taskDescription: "Write complex Python code with multiple dependencies" 
})
```

### For Human Operators

Operators can approve or reject pending configuration changes:

```javascript
// Approve a pending change
manage_config({ action: "approve", key: "openaiApiKey" })

// Reject a pending change
manage_config({ action: "reject", key: "openaiApiKey" })
```

## Configuration Policies

### SAFE Configurations (Auto-modifiable)

These settings can be safely modified by agents to optimize performance:

- `modelName` - Switch between models for different task types
- `llmProvider` - Change LLM provider (openai, google, bedrock, etc.)
- `memoryContextLimit` - Adjust memory context for complex tasks
- `memoryEpisodicLimit` - Tune episodic memory summaries
- `maxStepsPerAction` - Increase step budget for multi-step workflows
- `progressFeedbackEnabled` - Toggle progress feedback
- `searchProviderOrder` - Optimize search provider selection

### APPROVAL Configurations (Require Approval)

Sensitive settings that require human approval:

- `openaiApiKey` - OpenAI API key
- `googleApiKey` - Google API key
- `nvidiaApiKey` - NVIDIA API key
- `openrouterApiKey` - OpenRouter API key
- `braveSearchApiKey` - Brave Search API key
- `serperApiKey` - Serper API key
- `autonomyEnabled` - Enable autonomous operation
- `autonomyInterval` - Autonomous operation interval
- `skillRoutingRules` - Skill routing configuration

### LOCKED Configurations (Cannot Modify)

Security-critical settings that agents cannot modify:

- `telegramToken` - Telegram bot authentication
- `whatsappEnabled` - Channel architecture settings
- `commandDenyList` - Security deny lists
- `safeMode` - Safe mode flag
- `sudoMode` - Sudo mode flag
- `bedrockAccessKeyId` - AWS credentials
- `bedrockSecretAccessKey` - AWS credentials

## Agent Decision-Making

Agents can autonomously decide to modify configurations when:

1. **Task Requirements** - A task requires specific configuration (e.g., code tasks benefit from GPT-4)
2. **Performance Optimization** - Current settings are suboptimal for the workload
3. **Resource Constraints** - Need to adjust memory or step budgets
4. **Provider Availability** - LLM provider is unavailable, need to switch

### Optimization Suggestions

The system provides intelligent suggestions based on task context:

- **Code Tasks** → Suggest GPT-4 or similar reasoning-capable models
- **Complex Tasks** → Suggest higher memory context limits
- **Multi-step Workflows** → Suggest higher step budgets
- **Long-running Tasks** → Suggest appropriate timeout values

## Security Considerations

1. **Policy Enforcement** - All config changes are validated against policies
2. **Audit Trail** - All changes are logged with timestamp, reason, and actor
3. **Approval Workflow** - Sensitive changes require explicit approval
4. **Validation** - Value validation prevents invalid configurations
5. **Locked Settings** - Critical settings cannot be modified by agents

## Change History

The system maintains a history of all configuration changes:

- Timestamp of change
- Configuration key modified
- Old and new values
- Reason for change
- Approval status

History is limited to 50 most recent changes to prevent unbounded growth.

## Examples

### Example 1: Agent Optimizes for Code Task

```javascript
// Agent receives a complex coding task
Task: "Refactor this Python codebase and add comprehensive tests"

// Agent checks current model
Current modelName: "gpt-3.5-turbo"

// Agent suggests optimization
manage_config({ 
  action: "suggest", 
  taskDescription: "Refactor this Python codebase and add comprehensive tests" 
})
// Suggestion: Set modelName to "gpt-4" (Code tasks benefit from GPT-4)

// Agent applies change
manage_config({ 
  action: "set", 
  key: "modelName", 
  value: "gpt-4", 
  reason: "Code refactoring task benefits from GPT-4's superior reasoning" 
})
// Success: Configuration updated
```

### Example 2: Agent Requests API Key Update

```javascript
// Agent detects API key issue
Error: OpenAI API key is invalid

// Agent requests approval for new key
manage_config({ 
  action: "set", 
  key: "openaiApiKey", 
  value: "sk-new-valid-key", 
  reason: "Current API key is invalid, updating to working key" 
})
// Response: Configuration change requires approval. Request queued.

// Human operator reviews and approves
manage_config({ action: "pending" })
// Shows: openaiApiKey: sk-old-key → sk-new-valid-key (Reason: Current API key is invalid)

manage_config({ action: "approve", key: "openaiApiKey" })
// Success: Configuration updated
```

### Example 3: Agent Attempts Locked Config (Blocked)

```javascript
// Agent tries to modify safe mode (BLOCKED)
manage_config({ 
  action: "set", 
  key: "safeMode", 
  value: true, 
  reason: "Trying to enable safe mode" 
})
// Error: Configuration key "safeMode" is locked and cannot be modified by agents.
// Reason: Security-critical configuration
```

## Integration with Decision Engine

The config management system integrates with the decision engine to:

1. **Provide context** - Current configuration is available in decision context
2. **Suggest optimizations** - Recommendations are included in decision-making
3. **Track usage** - Configuration usage patterns inform future decisions
4. **Validate changes** - All proposed changes are validated before execution

## Future Enhancements

Potential improvements to the system:

1. **Machine Learning** - Learn optimal configs from historical task performance
2. **A/B Testing** - Test different configurations to find optimal settings
3. **Cost Optimization** - Automatically adjust configs to minimize API costs
4. **Performance Monitoring** - Track config impact on task completion metrics
5. **Rollback Support** - Automatic rollback on performance degradation
6. **Multi-agent Coordination** - Coordinate config changes across agent workers

## Testing

The system includes comprehensive tests in `tests/configManagement.test.ts`:

- Policy validation tests
- Safe config modification tests
- Locked config protection tests
- Approval workflow tests
- Value validation tests
- Change history tracking tests
- Optimization suggestion tests

Run tests with:
```bash
npm test tests/configManagement.test.ts
```

## Troubleshooting

### Agent Cannot Modify Config

**Problem**: Agent tries to modify a config but gets "locked" error.

**Solution**: Check the policy level. If locked, the config is security-critical and cannot be modified by agents. If approval-required, the change needs human approval.

### Pending Approval Not Visible

**Problem**: Agent requested approval but operator doesn't see it.

**Solution**: Use `manage_config({ action: "pending" })` to view all pending approval requests.

### Config Change Not Taking Effect

**Problem**: Config was modified but behavior hasn't changed.

**Solution**: Some config changes may require:
- Restarting the agent
- Reloading specific subsystems
- Waiting for next decision cycle

### Invalid Configuration Value

**Problem**: Agent tries to set invalid value and gets validation error.

**Solution**: Check the policy for that config key to see validation requirements. Ensure the value matches the expected type and constraints.

## Contributing

When adding new configuration options:

1. Add the option to `AgentConfig` interface in `src/config/ConfigManager.ts`
2. Add a policy entry in `src/config/ConfigPolicy.ts`
3. Choose appropriate security level (SAFE, APPROVAL, or LOCKED)
4. Add validation function if needed
5. Document the option in this guide
6. Add tests for the new option

## See Also

- [ConfigManager Documentation](../src/config/ConfigManager.ts)
- [Agent Skills Documentation](../SKILLS.md)
- [Decision Engine Documentation](../src/core/DecisionEngine.ts)

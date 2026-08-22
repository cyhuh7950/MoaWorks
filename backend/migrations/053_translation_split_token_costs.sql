ALTER TABLE translation_provider_configs
    ADD COLUMN IF NOT EXISTS input_cost_per_million_tokens NUMERIC(18, 8)
        CHECK (input_cost_per_million_tokens >= 0),
    ADD COLUMN IF NOT EXISTS output_cost_per_million_tokens NUMERIC(18, 8)
        CHECK (output_cost_per_million_tokens >= 0);

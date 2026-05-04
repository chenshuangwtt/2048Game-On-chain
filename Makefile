SHELL := /bin/bash

ANVIL_RPC_URL ?= http://127.0.0.1:8545
ANVIL_PRIVATE_KEY ?= 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ANVIL_LOG ?= /tmp/anvil-2048.log
SEPOLIA_RPC_URL ?=
BACKEND_URL ?= http://127.0.0.1:18080
SEED_MODE ?= backend
SUBGRAPH_URL ?= https://api.studio.thegraph.com/query/1747522/2048/version/latest

CONTRACT_DIR := contracts
FRONTEND_DIR := frontend
BACKEND_DIR := backend
ENV_FILE := $(FRONTEND_DIR)/.env.local

.PHONY: \
	anvil restart-anvil reset-anvil \
	deploy deploy-local deploy-sepolia update-sepolia-vrf \
	backend frontend dev web \
	build-contracts test clean help

anvil:
	@python3 -c 'import socket,sys; s=socket.socket(); s.settimeout(0.3); result=s.connect_ex(("127.0.0.1", 8545)); s.close(); sys.exit(0 if result==0 else 1)' || ( \
		echo "Starting Anvil..." && \
		anvil > "$(ANVIL_LOG)" 2>&1 & \
		sleep 1 \
	)

restart-anvil:
	@if ! command -v lsof >/dev/null 2>&1; then \
		echo "Missing command: lsof"; \
		exit 1; \
	fi
	@pids=$$(lsof -ti tcp:8545 2>/dev/null || true); \
	if [ -n "$$pids" ]; then \
		echo "Stopping Anvil on port 8545..."; \
		kill $$pids 2>/dev/null || true; \
	fi; \
	for i in {1..40}; do \
		if ! lsof -iTCP:8545 -sTCP:LISTEN -n -P >/dev/null 2>&1; then break; fi; \
		sleep 0.2; \
	done; \
	$(MAKE) anvil

deploy: deploy-local

deploy-local: anvil
	@echo "Deploying local VRF mock + OnChain2048Scores to $(ANVIL_RPC_URL)..."; \
	output=$$(cd "$(CONTRACT_DIR)" && VERIFIER_ADDRESS=$$(cast wallet address --private-key "$(ANVIL_PRIVATE_KEY)") ANVIL_PRIVATE_KEY="$(ANVIL_PRIVATE_KEY)" forge script script/DeployLocal.s.sol:DeployLocal \
		--rpc-url "$(ANVIL_RPC_URL)" \
		--broadcast); \
	echo "$$output"; \
	addr=$$(echo "$$output" | sed -n 's/^.*ONCHAIN2048_ADDRESS= //p' | tail -n 1); \
	if [ -z "$$addr" ]; then \
		echo "Failed to parse deployed contract address from script output."; \
		exit 1; \
	fi; \
	echo "NEXT_PUBLIC_CHAIN_ID=31337" > "$(ENV_FILE)"; \
	echo "NEXT_PUBLIC_SEED_MODE=$(SEED_MODE)" >> "$(ENV_FILE)"; \
	echo "NEXT_PUBLIC_SCORE_CONTRACT_ADDRESS=$$addr" >> "$(ENV_FILE)"; \
	echo "NEXT_PUBLIC_RPC_URL=$(ANVIL_RPC_URL)" >> "$(ENV_FILE)"; \
	echo "NEXT_PUBLIC_BACKEND_URL=$(BACKEND_URL)" >> "$(ENV_FILE)"; \
	echo "NEXT_PUBLIC_SUBGRAPH_URL=$(SUBGRAPH_URL)" >> "$(ENV_FILE)"; \
	echo "Wrote $(ENV_FILE)"

deploy-sepolia:
	@if [ -z "$(SEPOLIA_RPC_URL)" ]; then \
		echo "Missing SEPOLIA_RPC_URL"; \
		exit 1; \
	fi
	@echo "Deploying OnChain2048Scores to Sepolia..."; \
	output=$$(cd "$(CONTRACT_DIR)" && forge script script/DeploySepolia.s.sol:DeploySepolia \
		--rpc-url "$(SEPOLIA_RPC_URL)" \
		--broadcast); \
	echo "$$output"; \
	addr=$$(echo "$$output" | sed -n 's/^.*ONCHAIN2048_ADDRESS= //p' | tail -n 1); \
	if [ -z "$$addr" ]; then \
		echo "Failed to parse Sepolia contract address from script output."; \
		exit 1; \
	fi; \
	echo "NEXT_PUBLIC_CHAIN_ID=11155111" > "$(ENV_FILE)"; \
	echo "NEXT_PUBLIC_SEED_MODE=$(SEED_MODE)" >> "$(ENV_FILE)"; \
	echo "NEXT_PUBLIC_SCORE_CONTRACT_ADDRESS=$$addr" >> "$(ENV_FILE)"; \
	echo "NEXT_PUBLIC_RPC_URL=$(SEPOLIA_RPC_URL)" >> "$(ENV_FILE)"; \
	echo "NEXT_PUBLIC_BACKEND_URL=$(BACKEND_URL)" >> "$(ENV_FILE)"; \
	echo "NEXT_PUBLIC_SUBGRAPH_URL=$(SUBGRAPH_URL)" >> "$(ENV_FILE)"; \
	echo "Wrote $(ENV_FILE)"; \
	echo "Reminder: add the deployed contract as a VRF consumer and fund the subscription with LINK before testing vrf mode."

update-sepolia-vrf:
	@if [ -z "$(SEPOLIA_RPC_URL)" ]; then \
		echo "Missing SEPOLIA_RPC_URL"; \
		exit 1; \
	fi
	@echo "Updating VRF config for current Sepolia contract..."; \
	cd "$(CONTRACT_DIR)" && forge script script/UpdateSepoliaVrfConfig.s.sol:UpdateSepoliaVrfConfig \
		--rpc-url "$(SEPOLIA_RPC_URL)" \
		--broadcast

backend:
	@cd "$(BACKEND_DIR)" && cargo run

frontend:
	@cd "$(FRONTEND_DIR)" && \
	if [ ! -d node_modules ]; then \
		echo "Installing frontend dependencies..."; \
		npm install; \
	fi; \
	npm run dev

dev: restart-anvil deploy-local frontend

web: frontend

build-contracts:
	@cd "$(CONTRACT_DIR)" && forge build

test:
	@cd "$(CONTRACT_DIR)" && forge test

clean:
	@rm -rf "$(CONTRACT_DIR)/cache" "$(CONTRACT_DIR)/out" "$(FRONTEND_DIR)/.next" "$(FRONTEND_DIR)/out" "$(ANVIL_LOG)"
	@echo "Cleaned build artifacts."

reset-anvil:
	@echo "Stopping Anvil and clearing local chain state..."; \
	pkill -f "anvil" >/dev/null 2>&1 || true; \
	rm -f "$(ANVIL_LOG)"; \
	echo "Done. Restart with: make dev"

help:
	@echo "Targets:"
	@echo "  dev                Restart anvil, deploy local contract, run frontend"
	@echo "  backend            Run Rust verifier on default local settings"
	@echo "  frontend           Run Next.js dev server"
	@echo "  deploy             Alias of deploy-local"
	@echo "  deploy-local       Deploy local VRF mock + contract and write frontend env"
	@echo "  deploy-sepolia     Deploy contract to Sepolia and write frontend env"
	@echo "  update-sepolia-vrf Update VRF config of current Sepolia contract"
	@echo "  build-contracts    Compile contracts"
	@echo "  test               Run contract tests"
	@echo "  anvil              Start local anvil node"
	@echo "  clean              Remove build artifacts"
	@echo ""
	@echo "Variables:"
	@echo "  SEED_MODE=backend|vrf"
	@echo "  BACKEND_URL=http://127.0.0.1:18080"
	@echo "  SUBGRAPH_URL=https://api.studio.thegraph.com/query/1747522/2048/version/latest"

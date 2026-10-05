## 1.0.0 (2026-10-04)

### Refactor

- :card_file_box: Database schema v2: `customers`, `conversations`, `company_members`, `channels`, `analyses`, `customer_identities` (single `BaselineV2`, legacy migrations squashed)
- :recycle: Runtime rewired to v2 (assignment engine on `company_members`; the "company not resolved" path is gone; `customer_identities` is the resolution canon)

### Feat

- :sparkles: Channel credentials encrypted at rest (AES-256-GCM, `CREDENTIALS_ENCRYPTION_KEY`)
- :sparkles: UUIDv7 app-side ids and contract-owned domain values (varchar + zod, shared with the frontend)
- :sparkles: Explicit production migration runner (`dist/scripts/run-migrations.js`)
- :sparkles: Schema v2 implementation plan, contract map and cutover runbook (`docs/database/`)

### Fix

- :bug: Metrics raw SQL rewritten for v2 (removes the `m.contact_id` reference to a non-existent column)
- :bug: Inbound WhatsApp `wamid` persisted in `messages.external_id`

## 1.0.0-b1 (2025-11-16)

## 1.0.0-beta.0 (2025-11-16)

## 0.1.0 (2025-11-16)

### Feat

- :sparkles: Add sentiment analysis for realtime with gateway
- :sparkles: Add metrics for best agent for sentiments in chats
- :sparkles: Add best agents for metrics
- :sparkles: Add datetimes filter for sentiment metrics
- :sparkles: Add Kpis for month metrics and modules imports
- :sparkles: Add porcent last month with metrics
- :sparkles: Add kpis metrics
- :heavy_plus_sign: Add data-sns for dates in selecting data for kpis metrics
- :sparkles: Add sentiment analysis and transfer register for agent
- :card_file_box: Add notification entity and his controller
- :sparkles: Add query for user for chat view
- :sparkles: Add status for chat default in pending
- :sparkles: Add assigned user
- :sparkles: Add relations ids in messages
- :sparkles: Add handler status manager in socket gateway for users
- :sparkles: Add filter chats list for user autenticated
- :sparkles: Add handle error message fro whatsapp
- :fire: Delete duplicate methods
- :sparkles: Add join-chat event for join socket room
- :sparkles: Add send-message event for send messages to whatsapp
- :construction: Adding contact info in new message recived for whatsapp api
- :sparkles: Add search for contact
- :sparkles: Add MessagesController
- :card_file_box: Add firstNames, lastnames and username attributes at contact entity
- :construction: Add save messages from whatsapp api in database
- :sparkles: Add zod validation with nestjs-zod dependencie
- :poop: Add simple connection with chat and contact entity for recived messages from whatsapp
- :boom: Changes attributes in entities from chat module
- :sparkles: Add update and attributes for user entity
- :sparkles: Add table data funcionality
- :sparkles: Add contact crud methods for table
- :sparkles: Add search user for combobox UI
- :sparkles: Support to data table components
- :sparkles: Add search user for select input in frontend
- :zap: Add filter params helper and generals
- :sparkles: Change validations for verify access token in whatsapp webhook
- :recycle: Reorder import fix
- :sparkles: Modificated contact entity customerStatus changed to status attribute
- :sparkles: Add support for companies entity
- :sparkles: Add sort filter in contact table
- :sparkles: Add pagination with nestjs-typeorm-paginate package
- :sparkles: Add contact table and modify user entity
- :sparkles: Add client, exception filter, send message dto, types, interfaces ans custom exceptions
- :sparkles: Add client api feature and exception handler
- :sparkles: Add testing feature
- :sparkles: Add extractor for statuses and messages from whatsapp api
- :recycle: Refactor update method for id to businessId
- :sparkles: Add methods for whatsapp config
- :heavy_plus_sign: Add whatsapp types
- :sparkles: Add businessId to claims for jwt token
- :sparkles: Add subscriber for whatsapp config entity
- :sparkles: Add whatsapp config module
- :sparkles: Add redis config and refactor modules
- :poop: Add basic socket comunication and send api
- :passport_control: Add routes and fix minors
- :safety_vest: Add validation jwt + cookie implementation
- :sparkles: Configuration base

### Fix

- :bug: Fix commitizen file
- :bug: Add version in .cz.toml file
- Fix version in package.json
- :bug: Remove metrics log for range week
- :card_file_box: Change username to name for contact schema
- :ambulance: Save relations for user/agent and client in message
- :bug: Fix the export metrics services in module
- :bug: Change the createAt column to createdAt for sentiment entity
- :card_file_box: Change null last message relation for chat
- :bug: Fix agent relations in recived message to whatsapp webhook
- :bug: Fix direction in emmiting message
- :bug: Fix 'mediaUrl' change to optinal
- :bug: Fix change enum to type
- :ambulance: Fix update for whatsapp config assign null to companyId
- :technologist: Drop filter exception temporality for watch i18nValidations
- :bug: Fix data long for accessToken
- :fire: Drop duplicate code
- :bug: Drop Logs Files

### Refactor

- :bulb: Remove range log in metrics controller
- :recycle: Drop innecesary repos
- :fire: Drop redundante code in chat controller and service
- :recycle: Move file in controller folder for chat module
- :fire: Remove testing files
- :bricks: Change enum to type in UserRole
- :bulb: Drop commented code

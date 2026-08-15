#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================


user_problem_statement: "ATHLERA (existing codebase). Improve sport-specific scoring (Squash Let/Stroke/No Let rally-to-11, Tennis sets/tiebreak, Padel adv/golden/star, Badminton deuce/cap-30, Pickleball side-out). Streamlined live score. Competition vs One-Off. Private League/Knockout with auto/manual fixtures. Manage Fixtures. Public Events. Organiser permissions. Nearby players + location. Auto-add unselected sports at provisional rating. Light theme + gamification."

backend:
  - task: "Backend boot (JWT_SECRET env)"
    implemented: true
    working: true
    file: "backend/.env, backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: true
          agent: "main"
          comment: "Was crashing: KeyError JWT_SECRET. Added JWT_SECRET/JWT_ALGORITHM/ACCESS_TTL_MINUTES to backend/.env. Boot OK, /api/ 200, pytest 59/60 (1 stale V1 test)."

  - task: "Sport scoring engine (all 5 sports + live state machine + undo)"
    implemented: true
    working: "NA"
    file: "backend/scoring.py, backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Re-verify after crash fix: squash Let/Stroke/No Let + Undo, tennis tiebreak, padel golden/star, badminton cap-30, pickleball side-out; finalize applies rating changes."

  - task: "Competitions (private league/knockout, fixtures auto/manual, manage, results, organiser perms)"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Verify create, generate-fixtures round-robin/knockout byes, manual-result->standings/bracket, organiser 403, fixture PATCH schedule."

  - task: "Events (create public/private, register/withdraw, discovery auth-gated)"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Only public events in discovery, register/withdraw, capacity."

  - task: "Social: nearby, LTP, play-requests, messaging; auto-add provisional sport"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "nearby, LTP create/list, play-request dedupe/action, messaging thread, ensure-sport auto-add beginner provisional + implicit via live/create."

metadata:
  created_by: "main_agent"
  version: "2.0"
  test_sequence: 2
  run_ui: false

test_plan:
  current_focus:
    - "Sport scoring engine (all 5 sports + live state machine + undo)"
    - "Competitions (private league/knockout, fixtures auto/manual, manage, results, organiser perms)"
    - "Events (create public/private, register/withdraw, discovery auth-gated)"
    - "Social: nearby, LTP, play-requests, messaging; auto-add provisional sport"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    - agent: "main"
      message: "Resumed forked task. Fixed backend boot crash (missing JWT_SECRET). Backend healthy. QA account: qa.tester@athlera.dev / Test1234! (onboarded squash+tennis). Run COMPREHENSIVE backend testing of all required journeys."

# Create table in DynamoDB

- Enter table name, partition key, sort key (optional), default settings and create.

# Create GSI in DynamoDB table

- Enter partition key, sort key, index name, default settings and create

# AWS resources created

Region used is ap-south1. If different region, update in code.

- DynamoDB table VirtualClassroom-User (pk username)
- DynamoDB table VirtualClassroom-Assignments (pk assignmentid)
- DynamoDB table VirtualClassroom-Submissions (pk assignmentid & sk studentid)
- GSI on table VirtualClassroom-Assignments (pk tutorid & sk publishedat )
- GSI on table VirtualClassroom-Submissions (pk assignmentid & sk submittedat )
- GSI on table VirtualClassroom-Submissions (pk studentid & sk submittedat )

# Virtual Classroom Nodejs

This is backend assignment for job interview.

### Technologies

1. Express.js framework
2. AWS dynamodb
3. Heroku

### DynamoDB tables structure

![Schema diagram](https://github.com/mir1198yusuf/virtual-classroom-nodejs/blob/main/images/virtual-classroom-dynamodb.png?raw=true)

### List of endpoints

1. post /login
2. post /assignments
3. delete /assignments/:assignmentid
4. put /assignments/:assignmentid
5. post /assignments/:assignmentid/submissions
6. get /assignments/:assignmentid
7. get /assignments

### Live URL

- Base url of api is https://virtual-classroom-nodejs.herokuapp.com/

### Notification system design for upcoming assignments

- In User table we can store a new attribute - device token
- We can enable DynamoDB streams on Assignments table.
- In the lambda function triggered by DynamoDB stream, we can process the inserted assignment row and then query the database to fetch all the students assigned to it.
- Then we can using Firebase send push notification to all the students' device tokens.

##### Note - Documentation and project structure will be made better soon. Due to time restrictions, only necessary things are done. Also, I am not familiar with some tools. Proper tools diagram and documentation will be added later.
